use super::*;

fn folder(files: &[(&str, &str)]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nexsync-project-{}", uuid::Uuid::new_v4()));
    for (name, text) in files {
        let p = dir.join(name);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn ids(dir: &Path) -> Vec<&'static str> {
    detect_kinds(dir).iter().map(|k| k.id).collect()
}

#[test]
fn what_the_templates_make_is_found_as_what_they_are() {
    // Checked against the real output of uv init, sv create and create-tauri-app
    let uv = folder(&[("pyproject.toml", "[project]\nname=\"a\"\nrequires-python = \">=3.12\"\n"), (".python-version", "3.12\n"), ("hello.py", "print(1)")]);
    let d = detect(&uv);
    assert_eq!(d.tasks.iter().map(|t| t.command.as_str()).collect::<Vec<_>>(), ["uv sync", "uv run python hello.py"]);
    assert_eq!(d.tools.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["python", "uv"]);
    let kit = folder(&[("package.json", r#"{"devDependencies":{"@sveltejs/kit":"^3.0.0"},"scripts":{"dev":"vite dev"}}"#), ("vite.config.ts", "")]);
    assert!(ids(&kit).contains(&"sveltekit"));
    let tauri = folder(&[("package.json", r#"{"scripts":{"dev":"vite","tauri":"tauri"}}"#), ("src-tauri/tauri.conf.json", "{}"), ("index.html", ""), ("vite.config.ts", "")]);
    let d = detect(&tauri);
    assert!(!d.kinds.iter().any(|k| k.id == "static"), "index.html is not the project when the project is something else");
    assert!(d.tasks.iter().any(|t| t.id == "tauri-dev" && t.watch && t.command == "npm run tauri dev"));
    assert!(d.tools.iter().any(|t| t.name == "cargo"));
    let expo = folder(&[("package.json", r#"{"dependencies":{"expo":"~54"},"scripts":{"start":"expo start"}}"#), ("app.json", "{}")]);
    assert_eq!(detect(&expo).tasks.iter().find(|t| t.id == "start").map(|t| t.ports.clone()), Some(vec![8081]));
}

#[test]
fn a_vite_project_is_node_typescript_and_vite_with_scripts_for_tasks() {
    let dir = folder(&[("package.json", r#"{"scripts":{"dev":"vite","build":"vite build","test":"vitest"},"engines":{"node":">=20"}}"#), ("pnpm-lock.yaml", ""), ("vite.config.ts", ""), ("tsconfig.json", "{}"), (".env.example", "# The API the app talks to\nAPI_URL=http://x\nPLAIN=1\n")]);
    assert_eq!(ids(&dir), ["node", "typescript", "vite"]);
    let d = detect(&dir);
    assert_eq!(d.package_manager, Some("pnpm"));
    let cmd = |id: &str| d.tasks.iter().find(|t| t.id == id).map(|t| (t.command.clone(), t.watch, t.ports.clone()));
    assert_eq!(cmd("install"), Some(("pnpm install".into(), false, vec![])));
    assert_eq!(cmd("dev"), Some(("pnpm run dev".into(), true, vec![5173])));
    assert_eq!(cmd("test"), Some(("pnpm run test".into(), false, vec![])));
    assert_eq!(cmd("lint"), None);
    assert_eq!(d.tools, [ToolReq { name: "node".into(), range: ">=20".into() }, ToolReq { name: "pnpm".into(), range: String::new() }]);
    assert_eq!(d.env, [EnvVar { name: "API_URL".into(), description: "The API the app talks to".into() }, EnvVar { name: "PLAIN".into(), description: String::new() }]);
}

#[test]
fn other_ecosystems_are_found_by_their_marker_files() {
    for (files, expect) in [
        (vec![("Cargo.toml", "[package]\nname=\"a\"")], vec!["rust"]),
        (vec![("Cargo.toml", "[workspace]\nmembers=[]")], vec!["rust", "monorepo"]),
        (vec![("go.mod", "module a\n\ngo 1.22\n")], vec!["go"]),
        (vec![("manage.py", "import django"), ("requirements.txt", "django\npytest")], vec!["python", "django"]),
        (vec![("pom.xml", "<parent>spring-boot</parent>")], vec!["maven", "spring"]),
        (vec![("App.csproj", ""), ("global.json", r#"{"sdk":{"version":"8.0.100"}}"#)], vec!["dotnet"]),
        (vec![("pubspec.yaml", "dependencies:\n  flutter:\n")], vec!["flutter"]),
        (vec![("compose.yaml", ""), ("Dockerfile", "")], vec!["docker", "compose"]),
        (vec![("main.tf", "")], vec!["terraform"]),
        (vec![("project.godot", "")], vec!["godot"]),
        (vec![("artisan", ""), ("composer.json", "{}")], vec!["php", "laravel"]),
        (vec![("mix.exs", "{:phoenix, \"~> 1\"}")], vec!["elixir", "phoenix"]),
        (vec![("notes.txt", "nothing here")], vec![]),
    ] {
        let dir = folder(&files);
        assert_eq!(ids(&dir), expect, "{files:?}");
        let _ = fs::remove_dir_all(dir);
    }
}

#[test]
fn tools_take_their_versions_from_the_files_a_team_already_keeps() {
    let dir = folder(&[("go.mod", "module a\n\ngo 1.22\n"), (".tool-versions", "python 3.11.4\n")]);
    let go = default_tools(&dir, &detect_kinds(&dir));
    assert_eq!(go, [ToolReq { name: "go".into(), range: ">=1.22".into() }]);
    let py = folder(&[("pyproject.toml", "[project]\nrequires-python = \">=3.10\"\n"), (".python-version", "3.12\n")]);
    assert_eq!(default_tools(&py, &detect_kinds(&py))[0], ToolReq { name: "python".into(), range: "3.12".into() });
}

#[test]
fn a_recipe_from_someone_else_is_checked() {
    let ok = || Recipe { schema: 1, name: "App".into(), tasks: vec![task("dev", "Dev", "npm run dev")], ..Default::default() };
    assert!(check_recipe(ok()).is_ok());
    assert!(check_recipe(Recipe { schema: 2, ..ok() }).is_err(), "a newer version than this one reads");
    let mut r = ok();
    r.tasks[0].cwd = "../elsewhere".into();
    assert!(check_recipe(r).is_err(), "a task leaves the project");
    let mut r = ok();
    r.tasks.push(task("dev", "Again", "x"));
    assert!(check_recipe(r).is_err(), "a repeated task name");
    let mut r = ok();
    r.tasks[0].depends_on = vec!["build".into()];
    assert!(check_recipe(r).is_err(), "waits on nothing");
    let mut r = ok();
    r.tasks[0].env = vec!["KEY=secret".into()];
    assert!(check_recipe(r).is_err(), "a value instead of a name");
}

#[test]
fn fields_from_a_newer_version_survive_a_round_trip() {
    let text = r#"{"schema":1,"name":"A","tasks":[],"links":[{"label":"Staging","url":"https://x"}]}"#;
    let r = check_recipe(serde_json::from_str::<Recipe>(text).unwrap()).unwrap();
    assert!(serde_json::to_string(&r).unwrap().contains("Staging"));
}

#[test]
fn a_workspace_lists_its_projects_and_a_scratch_for_loose_files() {
    let ws = folder(&[("projects/web/package.json", "{}"), ("projects/api/Cargo.toml", ""), ("projects/loose.py", "x"), ("projects/web/node_modules/a/package.json", "{}")]);
    let list = list(&ws);
    assert_eq!(list.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Scratch", "api", "web"]);
    assert!(list[0].scratch && !list[1].scratch);
    let _ = fs::remove_dir_all(ws);
}
