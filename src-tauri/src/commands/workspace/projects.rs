//! Projects (Phase 20, step 2): what kind of project a folder is, the recipe a team shares for it, and the commands that follow.
//!
//! A project is a folder under `projects/`. Which kinds it is comes from a table of marker files, not from code per
//! ecosystem; a folder can be several kinds at once (a monorepo). What the team shares is `nexsync.project.json`, the
//! recipe: tasks, the tools they need, the names of the environment variables and where the preview is. A recipe comes from
//! other people, so reading one checks it, and nothing in this file runs a command.

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::syncignore::PROJECTS_ROOT;
use crate::commands::{config::validate_allowed_root, path_utils::resolve_workspace_path};

pub const RECIPE_FILE: &str = "nexsync.project.json";
const RECIPE_SCHEMA: u32 = 1;
const MAX_FILE_READ: u64 = 1024 * 1024;
const MAX_TASKS: usize = 40;
const MAX_TEXT: usize = 400;

// ────────────────────────────
// The recipe
// ────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSpec {
    pub id: String,
    pub label: String,
    pub command: String,
    /// A folder inside the project the command starts in; empty is the project's own folder
    #[serde(default)]
    pub cwd: String,
    /// Names of variables the task needs; never values
    #[serde(default)]
    pub env: Vec<String>,
    #[serde(default)]
    pub ports: Vec<u16>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// A task that keeps running until stopped (a dev server, a test watcher)
    #[serde(default)]
    pub watch: bool,
    /// A task that asks questions or needs a real terminal: it runs in one, not in the output list
    #[serde(default)]
    pub interactive: bool,
    /// Text in the output, or a port, that says the task is ready
    #[serde(default)]
    pub ready_when: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolReq {
    /// Which program: `node`, `python`, `cargo`, ...
    pub name: String,
    /// A version range such as `>=18`, `^20`, `3.11` or empty for any
    #[serde(default)]
    pub range: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

/// A way to read problems out of a task's output, written by the team: a regular expression with the groups `file` and `line`, and
/// optionally `column`, `message` and `severity`. It is only ever matched against output, never run.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatcherSpec {
    pub name: String,
    pub pattern: String,
    /// `error` or `warning`, when the pattern has no `severity` group
    #[serde(default)]
    pub severity: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub schema: u32,
    pub name: String,
    #[serde(default)]
    pub kinds: Vec<String>,
    #[serde(default)]
    pub tasks: Vec<TaskSpec>,
    #[serde(default)]
    pub tools: Vec<ToolReq>,
    #[serde(default)]
    pub env: Vec<EnvVar>,
    #[serde(default)]
    pub preview: Option<Preview>,
    /// More ways to find problems in output, beside the ones Nexsync knows
    #[serde(default)]
    pub matchers: Vec<MatcherSpec>,
    /// Fields from a newer version of Nexsync are kept as they are, not dropped
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

fn clean(text: &str) -> String {
    text.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(MAX_TEXT).collect()
}

pub(crate) fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// A recipe is text from another person, so it is checked before anything uses it: version known, names well formed, a task's
/// folder inside the project, no task waiting on one that does not exist
/// The expression of a matcher, or why it cannot be used: it has to compile (within a size limit, so a recipe cannot make
/// matching slow) and name the groups `file` and `line`
pub fn compile_matcher(m: &MatcherSpec) -> Result<regex::Regex, String> {
    let re = regex::RegexBuilder::new(&m.pattern).size_limit(256 * 1024).build().map_err(|e| format!("Matcher \"{}\" is not a valid pattern: {e}", m.name))?;
    let names: Vec<_> = re.capture_names().flatten().collect();
    if !names.contains(&"file") || !names.contains(&"line") {
        return Err(format!("Matcher \"{}\" needs the groups (?P<file>...) and (?P<line>...).", m.name));
    }
    Ok(re)
}

pub fn check_recipe(mut r: Recipe) -> Result<Recipe, String> {
    if r.schema == 0 || r.schema > RECIPE_SCHEMA {
        return Err(format!("This recipe is version {}, and this Nexsync reads version {RECIPE_SCHEMA}. Update Nexsync to use it.", r.schema));
    }
    r.name = clean(&r.name);
    if r.tasks.len() > MAX_TASKS {
        return Err(format!("A recipe may have at most {MAX_TASKS} tasks."));
    }
    let mut seen = HashSet::new();
    for t in &mut r.tasks {
        if !valid_name(&t.id) || !seen.insert(t.id.clone()) {
            return Err(format!("Task name \"{}\" is empty, repeated or has characters other than letters, digits, - _ and .", t.id));
        }
        t.label = clean(&t.label);
        if t.label.is_empty() {
            t.label = t.id.clone();
        }
        t.command = t.command.trim().to_string();
        if t.command.is_empty() || t.command.len() > 2000 || t.command.contains('\0') {
            return Err(format!("Task \"{}\" needs a command of up to 2000 characters.", t.id));
        }
        t.cwd = t.cwd.trim().trim_matches('/').replace('\\', "/");
        if t.cwd.split('/').any(|p| p == ".." || p.contains(':')) || t.cwd.starts_with('/') {
            return Err(format!("Task \"{}\" must start inside the project folder.", t.id));
        }
        if t.env.iter().any(|n| !valid_name(n)) {
            return Err(format!("Task \"{}\" lists a variable name that is not valid. Names only, never values.", t.id));
        }
        t.ready_when = clean(&t.ready_when);
    }
    let ids: HashSet<&str> = r.tasks.iter().map(|t| t.id.as_str()).collect();
    for t in &r.tasks {
        if let Some(missing) = t.depends_on.iter().find(|d| !ids.contains(d.as_str())) {
            return Err(format!("Task \"{}\" waits on \"{missing}\", which is not in the recipe.", t.id));
        }
    }
    for tool in &mut r.tools {
        tool.name = clean(&tool.name).to_lowercase();
        tool.range = clean(&tool.range);
    }
    r.tools.retain(|t| !t.name.is_empty());
    for e in &mut r.env {
        e.description = clean(&e.description);
    }
    if r.matchers.len() > 10 {
        return Err("A recipe may have at most 10 problem matchers.".to_string());
    }
    for m in &mut r.matchers {
        m.name = clean(&m.name);
        compile_matcher(m)?;
        if !m.severity.is_empty() && m.severity != "error" && m.severity != "warning" {
            return Err(format!("Matcher \"{}\": severity is error or warning.", m.name));
        }
    }
    if r.env.iter().any(|e| !valid_name(&e.name)) {
        return Err("An environment variable name is not valid.".to_string());
    }
    Ok(r)
}

// ────────────────────────────
// Detection
// ────────────────────────────

/// One kind of project: any of `files` present (a name, `*.ext`, or a path) and, when `needs` is given, one of its files
/// containing its text. Kinds that are more specific than another (Vite over Node) just also match; nothing excludes.
struct Rule {
    id: &'static str,
    label: &'static str,
    group: &'static str,
    files: &'static [&'static str],
    needs: Option<(&'static [&'static str], &'static str)>,
}

const PKG: &[&str] = &["package.json"];
const PY: &[&str] = &["pyproject.toml", "requirements.txt", "Pipfile", "setup.py", "setup.cfg"];

const RULES: &[Rule] = &[
    // JavaScript and the web
    Rule { id: "node", label: "Node.js", group: "Web", files: &["package.json"], needs: None },
    Rule { id: "typescript", label: "TypeScript", group: "Web", files: &["tsconfig.json"], needs: None },
    Rule { id: "vite", label: "Vite", group: "Web", files: &["vite.config.ts", "vite.config.js", "vite.config.mjs"], needs: None },
    Rule { id: "next", label: "Next.js", group: "Web", files: &["next.config.js", "next.config.mjs", "next.config.ts"], needs: None },
    Rule { id: "nuxt", label: "Nuxt", group: "Web", files: &["nuxt.config.ts", "nuxt.config.js"], needs: None },
    Rule { id: "sveltekit", label: "SvelteKit", group: "Web", files: PKG, needs: Some((PKG, "@sveltejs/kit")) },
    Rule { id: "astro", label: "Astro", group: "Web", files: &["astro.config.mjs", "astro.config.ts", "astro.config.js"], needs: None },
    Rule { id: "remix", label: "Remix", group: "Web", files: PKG, needs: Some((PKG, "@remix-run")) },
    Rule { id: "angular", label: "Angular", group: "Web", files: &["angular.json"], needs: None },
    Rule { id: "cra", label: "Create React App", group: "Web", files: PKG, needs: Some((PKG, "react-scripts")) },
    Rule { id: "gatsby", label: "Gatsby", group: "Web", files: &["gatsby-config.js", "gatsby-config.ts"], needs: None },
    Rule { id: "docusaurus", label: "Docusaurus", group: "Docs", files: &["docusaurus.config.js", "docusaurus.config.ts"], needs: None },
    Rule { id: "static", label: "Static HTML", group: "Web", files: &["index.html"], needs: None },
    // Node services and apps
    Rule { id: "express", label: "Express", group: "Services", files: PKG, needs: Some((PKG, "\"express\"")) },
    Rule { id: "fastify", label: "Fastify", group: "Services", files: PKG, needs: Some((PKG, "\"fastify\"")) },
    Rule { id: "nest", label: "NestJS", group: "Services", files: PKG, needs: Some((PKG, "@nestjs/core")) },
    Rule { id: "hono", label: "Hono", group: "Services", files: PKG, needs: Some((PKG, "\"hono\"")) },
    Rule { id: "electron", label: "Electron", group: "Desktop", files: PKG, needs: Some((PKG, "\"electron\"")) },
    Rule { id: "tauri", label: "Tauri", group: "Desktop", files: &["src-tauri/tauri.conf.json", "tauri.conf.json"], needs: None },
    Rule { id: "react-native", label: "React Native", group: "Mobile", files: PKG, needs: Some((PKG, "\"react-native\"")) },
    Rule { id: "expo", label: "Expo", group: "Mobile", files: &["app.json"], needs: Some((PKG, "\"expo\"")) },
    // Python
    Rule { id: "python", label: "Python", group: "Python", files: PY, needs: None },
    Rule { id: "poetry", label: "Poetry", group: "Python", files: &["poetry.lock"], needs: None },
    Rule { id: "uv", label: "uv", group: "Python", files: &["uv.lock"], needs: None },
    Rule { id: "django", label: "Django", group: "Python", files: &["manage.py"], needs: Some((&["manage.py"], "django")) },
    Rule { id: "flask", label: "Flask", group: "Python", files: PY, needs: Some((PY, "flask")) },
    Rule { id: "fastapi", label: "FastAPI", group: "Python", files: PY, needs: Some((PY, "fastapi")) },
    Rule { id: "streamlit", label: "Streamlit", group: "Python", files: PY, needs: Some((PY, "streamlit")) },
    Rule { id: "jupyter", label: "Jupyter notebooks", group: "Data", files: &["*.ipynb"], needs: None },
    // Compiled languages
    Rule { id: "rust", label: "Rust", group: "Rust", files: &["Cargo.toml"], needs: None },
    Rule { id: "go", label: "Go", group: "Go", files: &["go.mod"], needs: None },
    Rule { id: "maven", label: "Maven", group: "Java", files: &["pom.xml"], needs: None },
    Rule { id: "gradle", label: "Gradle", group: "Java", files: &["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"], needs: None },
    Rule { id: "spring", label: "Spring Boot", group: "Java", files: &["pom.xml", "build.gradle", "build.gradle.kts"], needs: Some((&["pom.xml", "build.gradle", "build.gradle.kts"], "spring-boot")) },
    Rule { id: "dotnet", label: ".NET", group: ".NET", files: &["*.csproj", "*.sln", "*.fsproj", "global.json"], needs: None },
    Rule { id: "php", label: "PHP", group: "PHP", files: &["composer.json"], needs: None },
    Rule { id: "laravel", label: "Laravel", group: "PHP", files: &["artisan"], needs: None },
    Rule { id: "symfony", label: "Symfony", group: "PHP", files: &["symfony.lock"], needs: None },
    Rule { id: "ruby", label: "Ruby", group: "Ruby", files: &["Gemfile"], needs: None },
    Rule { id: "rails", label: "Rails", group: "Ruby", files: &["config/application.rb"], needs: None },
    Rule { id: "elixir", label: "Elixir", group: "Elixir", files: &["mix.exs"], needs: None },
    Rule { id: "phoenix", label: "Phoenix", group: "Elixir", files: &["mix.exs"], needs: Some((&["mix.exs"], ":phoenix")) },
    Rule { id: "swift", label: "Swift", group: "Apple", files: &["Package.swift", "*.xcodeproj", "*.xcworkspace"], needs: None },
    Rule { id: "flutter", label: "Flutter", group: "Mobile", files: &["pubspec.yaml"], needs: Some((&["pubspec.yaml"], "flutter")) },
    Rule { id: "android", label: "Android", group: "Mobile", files: &["app/src/main/AndroidManifest.xml"], needs: None },
    Rule { id: "cmake", label: "CMake", group: "C and C++", files: &["CMakeLists.txt"], needs: None },
    Rule { id: "make", label: "Make", group: "C and C++", files: &["Makefile", "makefile"], needs: None },
    Rule { id: "meson", label: "Meson", group: "C and C++", files: &["meson.build"], needs: None },
    // Games, data, docs, infrastructure
    Rule { id: "unity", label: "Unity", group: "Games", files: &["ProjectSettings/ProjectVersion.txt"], needs: None },
    Rule { id: "godot", label: "Godot", group: "Games", files: &["project.godot"], needs: None },
    Rule { id: "unreal", label: "Unreal Engine", group: "Games", files: &["*.uproject"], needs: None },
    Rule { id: "dvc", label: "DVC", group: "Data", files: &["dvc.yaml", ".dvc"], needs: None },
    Rule { id: "mkdocs", label: "MkDocs", group: "Docs", files: &["mkdocs.yml", "mkdocs.yaml"], needs: None },
    Rule { id: "hugo", label: "Hugo", group: "Docs", files: &["hugo.toml", "hugo.yaml", "hugo.json"], needs: None },
    Rule { id: "jekyll", label: "Jekyll", group: "Docs", files: &["_config.yml"], needs: Some((&["Gemfile"], "jekyll")) },
    Rule { id: "mdbook", label: "mdBook", group: "Docs", files: &["book.toml"], needs: None },
    Rule { id: "docker", label: "Docker", group: "Infrastructure", files: &["Dockerfile"], needs: None },
    Rule { id: "compose", label: "Docker Compose", group: "Infrastructure", files: &["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"], needs: None },
    Rule { id: "terraform", label: "Terraform", group: "Infrastructure", files: &["*.tf"], needs: None },
    Rule { id: "helm", label: "Helm", group: "Infrastructure", files: &["Chart.yaml"], needs: None },
    // Several projects in one folder
    Rule { id: "monorepo", label: "Monorepo", group: "Workspace", files: &["pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json", "rush.json", "WORKSPACE", "MODULE.bazel"], needs: None },
    Rule { id: "monorepo", label: "Monorepo", group: "Workspace", files: PKG, needs: Some((PKG, "\"workspaces\"")) },
    Rule { id: "monorepo", label: "Monorepo", group: "Workspace", files: &["Cargo.toml"], needs: Some((&["Cargo.toml"], "[workspace]")) },
];

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Kind {
    pub id: &'static str,
    pub label: &'static str,
    pub group: &'static str,
}

pub(crate) fn read(dir: &Path, name: &str) -> Option<String> {
    let path = dir.join(name);
    let meta = fs::metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > MAX_FILE_READ {
        return None;
    }
    fs::read_to_string(path).ok()
}

fn has(dir: &Path, marker: &str) -> bool {
    if let Some(ext) = marker.strip_prefix("*.") {
        let suffix = format!(".{ext}");
        return fs::read_dir(dir).map(|rd| rd.filter_map(Result::ok).any(|e| e.file_name().to_string_lossy().ends_with(&suffix))).unwrap_or(false);
    }
    dir.join(marker).exists()
}

/// Which kinds of project the folder is, most general first, each once
pub fn detect_kinds(dir: &Path) -> Vec<Kind> {
    let mut out: Vec<Kind> = Vec::new();
    for rule in RULES {
        if out.iter().any(|k| k.id == rule.id) || !rule.files.iter().any(|f| has(dir, f)) {
            continue;
        }
        if let Some((files, text)) = rule.needs {
            if !files.iter().filter_map(|f| read(dir, f)).any(|c| c.to_lowercase().contains(&text.to_lowercase())) {
                continue;
            }
        }
        out.push(Kind { id: rule.id, label: rule.label, group: rule.group });
    }
    if out.len() > 1 {
        out.retain(|k| k.id != "static");
    }
    out
}

/// A Python project run with uv: it has a lock file, or says so, or is what `uv init` makes (a `.python-version` and a `pyproject.toml`
/// and none of the other tools' files)
fn uses_uv(dir: &Path, kinds: &[Kind]) -> bool {
    if kinds.iter().any(|k| k.id == "uv") {
        return true;
    }
    let toml = read(dir, "pyproject.toml").unwrap_or_default();
    kinds.iter().any(|k| k.id == "python") && (toml.contains("[tool.uv]") || (has(dir, ".python-version") && !toml.is_empty() && !toml.contains("[tool.poetry]") && !has(dir, "requirements.txt") && !has(dir, "Pipfile")))
}

/// The package manager a Node project uses, from its lock file
pub fn package_manager(dir: &Path) -> &'static str {
    if has(dir, "pnpm-lock.yaml") {
        "pnpm"
    } else if has(dir, "yarn.lock") {
        "yarn"
    } else if has(dir, "bun.lockb") || has(dir, "bun.lock") {
        "bun"
    } else {
        "npm"
    }
}

fn task(id: &str, label: &str, command: impl Into<String>) -> TaskSpec {
    TaskSpec { id: id.into(), label: label.into(), command: command.into(), ..Default::default() }
}

fn server(id: &str, label: &str, command: impl Into<String>, port: u16) -> TaskSpec {
    TaskSpec { watch: true, ports: vec![port], ..task(id, label, command) }
}

fn wrapper(name: &str) -> String {
    if cfg!(windows) { name.to_string() } else { format!("./{name}") }
}

/// The commands the kinds of project usually have, from what is in the folder (a Node project's come from its scripts)
pub fn default_tasks(dir: &Path, kinds: &[Kind]) -> Vec<TaskSpec> {
    let is = |id: &str| kinds.iter().any(|k| k.id == id);
    let mut tasks: Vec<TaskSpec> = Vec::new();
    let mut add = |t: TaskSpec| {
        // A task that does what another already does (a Makefile's `build` next to the default one) is not listed twice
        if !tasks.iter().any(|x| x.id == t.id || x.command == t.command) {
            tasks.push(t);
        }
    };

    if is("node") {
        let pm = package_manager(dir);
        let run = |script: &str| match (pm, script) {
            ("npm", "test") => "npm test".to_string(),
            ("npm", s) => format!("npm run {s}"),
            ("yarn", s) => format!("yarn {s}"),
            (pm, s) => format!("{pm} run {s}"),
        };
        add(task("install", "Install", format!("{pm} install")));
        let scripts: Vec<String> = read(dir, "package.json")
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| v.get("scripts").and_then(Value::as_object).map(|o| o.keys().cloned().collect()))
            .unwrap_or_default();
        let port = [("expo", 8081), ("react-native", 8081), ("next", 3000), ("nuxt", 3000), ("astro", 4321), ("angular", 4200), ("cra", 3000), ("gatsby", 8000), ("docusaurus", 3000), ("vite", 5173), ("sveltekit", 5173), ("remix", 3000)]
            .into_iter()
            .find(|(id, _)| is(id))
            .map(|(_, p)| p);
        for (script, label) in [("dev", "Start the Dev Server"), ("start", "Start"), ("serve", "Serve")] {
            if scripts.iter().any(|s| s == script) {
                let id = if script == "serve" { "serve" } else { script };
                add(match port {
                    Some(p) => server(id, label, run(script), p),
                    None => TaskSpec { watch: true, ..task(id, label, run(script)) },
                });
            }
        }
        for (script, label) in [("build", "Build"), ("test", "Test"), ("lint", "Lint"), ("format", "Format"), ("typecheck", "Check Types"), ("preview", "Preview the Build")] {
            if scripts.iter().any(|s| s == script) {
                add(task(script, label, run(script)));
            }
        }
        // Tauri: the desktop app is started by its own command, not by the web dev server
        if is("tauri") && scripts.iter().any(|s| s == "tauri") {
            add(TaskSpec { watch: true, ..task("tauri-dev", "Start the Desktop App", format!("{} dev", run("tauri"))) });
            add(task("tauri-build", "Build the Desktop App", format!("{} build", run("tauri"))));
        }
    }

    if is("python") {
        let toml = read(dir, "pyproject.toml").unwrap_or_default();
        let (prefix, install) = if uses_uv(dir, kinds) {
            ("uv run ", "uv sync".to_string())
        } else if is("poetry") || toml.contains("[tool.poetry]") {
            ("poetry run ", "poetry install".to_string())
        } else if has(dir, "Pipfile") {
            ("pipenv run ", "pipenv install".to_string())
        } else if has(dir, "requirements.txt") {
            ("", "pip install -r requirements.txt".to_string())
        } else {
            ("", "pip install -e .".to_string())
        };
        add(task("install", "Install", install));
        if is("django") {
            add(server("dev", "Start the Dev Server", format!("{prefix}python manage.py runserver"), 8000));
            add(task("test", "Test", format!("{prefix}python manage.py test")));
        } else if is("fastapi") {
            add(server("dev", "Start the Dev Server", format!("{prefix}fastapi dev"), 8000));
        } else if is("flask") {
            add(server("dev", "Start the Dev Server", format!("{prefix}flask run"), 5000));
        } else if is("streamlit") {
            add(server("dev", "Start the App", format!("{prefix}streamlit run app.py"), 8501));
        }
        let text = format!("{toml}{}{}", read(dir, "requirements.txt").unwrap_or_default(), read(dir, "Pipfile").unwrap_or_default()).to_lowercase();
        // A plain script project: run its entry file
        if !is("django") && !is("fastapi") && !is("flask") && !is("streamlit") {
            if let Some(entry) = ["main.py", "app.py", "hello.py", "__main__.py"].iter().find(|f| has(dir, f)) {
                add(task("run", "Run", format!("{prefix}python {entry}")));
            }
        }
        if (text.contains("pytest") || has(dir, "tests")) && !is("django") {
            add(task("test", "Test", format!("{prefix}pytest")));
        }
        if text.contains("ruff") {
            add(task("lint", "Lint", format!("{prefix}ruff check .")));
        }
    }

    if is("rust") {
        for (id, label, cmd) in [("build", "Build", "cargo build"), ("run", "Run", "cargo run"), ("test", "Test", "cargo test"), ("lint", "Lint", "cargo clippy"), ("format", "Format", "cargo fmt")] {
            add(task(id, label, cmd));
        }
    }
    if is("go") {
        for (id, label, cmd) in [("build", "Build", "go build ./..."), ("run", "Run", "go run ."), ("test", "Test", "go test ./..."), ("lint", "Check", "go vet ./...")] {
            add(task(id, label, cmd));
        }
    }
    if is("maven") {
        add(task("build", "Build", "mvn package"));
        add(task("test", "Test", "mvn test"));
        if is("spring") {
            add(server("dev", "Start the App", "mvn spring-boot:run", 8080));
        }
    }
    if is("gradle") {
        let g = if has(dir, "gradlew") || has(dir, "gradlew.bat") { wrapper("gradlew") } else { "gradle".to_string() };
        add(task("build", "Build", format!("{g} build")));
        add(task("test", "Test", format!("{g} test")));
        if is("spring") {
            add(server("dev", "Start the App", format!("{g} bootRun"), 8080));
        }
    }
    if is("dotnet") {
        add(task("build", "Build", "dotnet build"));
        add(task("test", "Test", "dotnet test"));
        add(TaskSpec { watch: true, ..task("dev", "Run", "dotnet watch run") });
    }
    if is("php") {
        add(task("install", "Install", "composer install"));
        if is("laravel") {
            add(server("dev", "Start the Dev Server", "php artisan serve", 8000));
            add(task("test", "Test", "php artisan test"));
        }
    }
    if is("ruby") {
        add(task("install", "Install", "bundle install"));
        if is("rails") {
            add(server("dev", "Start the Dev Server", "bundle exec rails server", 3000));
            add(task("test", "Test", if has(dir, "spec") { "bundle exec rspec" } else { "bundle exec rails test" }));
        } else if has(dir, "spec") {
            add(task("test", "Test", "bundle exec rspec"));
        }
    }
    if is("elixir") {
        add(task("install", "Install", "mix deps.get"));
        add(task("build", "Build", "mix compile"));
        add(task("test", "Test", "mix test"));
        if is("phoenix") {
            add(server("dev", "Start the Dev Server", "mix phx.server", 4000));
        }
    }
    if is("swift") && has(dir, "Package.swift") {
        for (id, label, cmd) in [("build", "Build", "swift build"), ("run", "Run", "swift run"), ("test", "Test", "swift test")] {
            add(task(id, label, cmd));
        }
    }
    if is("flutter") {
        add(task("install", "Install", "flutter pub get"));
        add(TaskSpec { watch: true, ..task("dev", "Run", "flutter run") });
        add(task("test", "Test", "flutter test"));
        add(task("lint", "Analyze", "flutter analyze"));
    }
    if is("cmake") {
        add(task("configure", "Configure", "cmake -B build"));
        add(task("build", "Build", "cmake --build build"));
        add(task("test", "Test", "ctest --test-dir build"));
    } else if is("meson") {
        add(task("configure", "Configure", "meson setup build"));
        add(task("build", "Build", "meson compile -C build"));
    } else if is("make") {
        add(task("build", "Build", "make"));
        add(task("test", "Test", "make test"));
    }
    if is("compose") {
        add(TaskSpec { watch: true, ..task("up", "Start the Services", "docker compose up") });
        add(task("down", "Stop the Services", "docker compose down"));
        add(task("build", "Build the Images", "docker compose build"));
        add(TaskSpec { watch: true, ..task("logs", "Follow the Logs", "docker compose logs -f --tail 100") });
        add(task("ps", "List the Containers", "docker compose ps"));
    } else if is("docker") {
        // One image from the Dockerfile at the top, tagged with the folder's name, and a run that publishes the ports it EXPOSEs
        let tag: String = dir.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default().chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '-' }).collect();
        if !tag.is_empty() && dir.join("Dockerfile").is_file() {
            let ports = read(dir, "Dockerfile").map(|t| super::project_containers::expose_ports(&t)).unwrap_or_default();
            let publish: String = ports.iter().map(|p| format!(" -p {p}:{p}")).collect();
            add(task("build", "Build the Image", format!("docker build -t {tag} .")));
            add(TaskSpec { watch: true, ports: ports.clone(), ..task("run", "Run the Image", format!("docker run --rm{publish} {tag}")) });
        }
    }
    if is("terraform") {
        add(task("install", "Initialise", "terraform init"));
        add(task("lint", "Validate", "terraform validate"));
        add(task("plan", "Plan", "terraform plan"));
    }
    if is("mkdocs") {
        add(server("dev", "Serve the Docs", "mkdocs serve", 8000));
        add(task("build", "Build", "mkdocs build"));
    }
    if is("hugo") {
        add(server("dev", "Serve the Site", "hugo server", 1313));
        add(task("build", "Build", "hugo"));
    }
    if is("jekyll") {
        add(server("dev", "Serve the Site", "bundle exec jekyll serve", 4000));
    }
    if is("mdbook") {
        add(server("dev", "Serve the Book", "mdbook serve", 3000));
        add(task("build", "Build", "mdbook build"));
    }
    // What the folder's own files name: Makefile targets, justfile recipes, a Taskfile, a Procfile, scripts/
    for t in super::project_targets::discover(dir).0 {
        add(t);
    }
    tasks
}

/// The programs a project needs and the version it names, read from the files teams already keep for this
pub fn default_tools(dir: &Path, kinds: &[Kind]) -> Vec<ToolReq> {
    let is = |id: &str| kinds.iter().any(|k| k.id == id);
    let mut tools: Vec<ToolReq> = Vec::new();
    let mut add = |name: &str, range: String| {
        if !tools.iter().any(|t| t.name == name) {
            tools.push(ToolReq { name: name.to_string(), range });
        }
    };
    let versions_file = read(dir, ".tool-versions").unwrap_or_default();
    let tool_version = |names: &[&str]| -> String {
        versions_file
            .lines()
            .filter_map(|l| {
                let mut p = l.split_whitespace();
                Some((p.next()?, p.next()?))
            })
            .find(|(n, _)| names.contains(n))
            .map(|(_, v)| v.to_string())
            .unwrap_or_default()
    };
    let first_line = |name: &str| read(dir, name).map(|t| t.lines().next().unwrap_or("").trim().trim_start_matches('v').to_string()).filter(|v| v.chars().next().is_some_and(|c| c.is_ascii_digit())).unwrap_or_default();

    if is("node") {
        let engines = read(dir, "package.json").and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v.pointer("/engines/node").and_then(Value::as_str).map(str::to_string)).unwrap_or_default();
        let range = [first_line(".nvmrc"), first_line(".node-version"), tool_version(&["nodejs", "node"]), engines].into_iter().find(|s| !s.is_empty()).unwrap_or_default();
        add("node", range);
        match package_manager(dir) {
            "npm" => add("npm", String::new()),
            pm => add(pm, String::new()),
        }
    }
    if is("python") {
        let requires = read(dir, "pyproject.toml")
            .and_then(|t| t.lines().find(|l| l.trim_start().starts_with("requires-python")).map(|l| l.split('=').skip(1).collect::<Vec<_>>().join("=").trim().trim_matches(['"', '\'']).to_string()))
            .unwrap_or_default();
        let range = [first_line(".python-version"), tool_version(&["python"]), requires].into_iter().find(|s| !s.is_empty()).unwrap_or_default();
        add("python", range);
        if uses_uv(dir, kinds) {
            add("uv", String::new());
        }
        if is("poetry") {
            add("poetry", String::new());
        }
    }
    if is("rust") || is("tauri") {
        add("cargo", String::new());
        add("rustc", String::new());
    }
    if is("go") {
        let range = read(dir, "go.mod").and_then(|t| t.lines().find_map(|l| l.strip_prefix("go ").map(|v| format!(">={}", v.trim())))).unwrap_or_default();
        add("go", range);
    }
    if is("maven") {
        add("java", String::new());
        add("mvn", String::new());
    }
    if is("gradle") {
        add("java", String::new());
        if !has(dir, "gradlew") && !has(dir, "gradlew.bat") {
            add("gradle", String::new());
        }
    }
    if is("dotnet") {
        let range = read(dir, "global.json").and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v.pointer("/sdk/version").and_then(Value::as_str).map(|s| s.split('.').take(2).collect::<Vec<_>>().join("."))).unwrap_or_default();
        add("dotnet", range);
    }
    if is("php") {
        add("php", String::new());
        add("composer", String::new());
    }
    if is("ruby") {
        add("ruby", [first_line(".ruby-version"), tool_version(&["ruby"])].into_iter().find(|s| !s.is_empty()).unwrap_or_default());
        add("bundler", String::new());
    }
    if is("elixir") {
        add("elixir", String::new());
    }
    if is("swift") && has(dir, "Package.swift") {
        add("swift", String::new());
    }
    if is("flutter") {
        add("flutter", String::new());
    }
    if is("cmake") {
        add("cmake", String::new());
    }
    if is("make") && !is("cmake") {
        add("make", String::new());
    }
    if is("compose") || is("docker") {
        add("docker", String::new());
    }
    if is("terraform") {
        add("terraform", String::new());
    }
    for t in super::project_targets::discover(dir).1 {
        add(&t.name, String::new());
    }
    tools
}

/// Variable names and what they are for, from `.env.example` (or `.env.sample`): the comment line above a name describes it
pub fn env_names(dir: &Path) -> Vec<EnvVar> {
    let text = [".env.example", ".env.sample", ".env.template"].iter().find_map(|f| read(dir, f)).unwrap_or_default();
    let mut out: Vec<EnvVar> = Vec::new();
    let mut note = String::new();
    for line in text.lines().map(str::trim) {
        if let Some(c) = line.strip_prefix('#') {
            note = c.trim().to_string();
        } else if let Some((name, _)) = line.trim_start_matches("export ").split_once('=') {
            let name = name.trim();
            if valid_name(name) && !out.iter().any(|e| e.name == name) {
                out.push(EnvVar { name: name.to_string(), description: clean(&note) });
            }
            note.clear();
        } else {
            note.clear();
        }
    }
    out.truncate(200);
    out
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    pub kinds: Vec<Kind>,
    pub package_manager: Option<&'static str>,
    pub tasks: Vec<TaskSpec>,
    pub tools: Vec<ToolReq>,
    pub env: Vec<EnvVar>,
}

pub fn detect(dir: &Path) -> Detected {
    let kinds = detect_kinds(dir);
    let node = kinds.iter().any(|k| k.id == "node");
    Detected { tasks: default_tasks(dir, &kinds), tools: default_tools(dir, &kinds), env: env_names(dir), package_manager: node.then(|| package_manager(dir)), kinds }
}

// ────────────────────────────
// Projects in a workspace
// ────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    /// The folder's name, which is also what the project is called unless its recipe says otherwise
    pub id: String,
    /// Workspace-relative, such as `projects/app`
    pub path: String,
    pub name: String,
    /// Files directly in `projects/` rather than in a project folder of their own
    pub scratch: bool,
    pub detected: Detected,
    pub recipe: Option<Recipe>,
    /// Why the recipe in the folder could not be used, when it could not
    pub recipe_error: Option<String>,
}

fn load_recipe(dir: &Path) -> (Option<Recipe>, Option<String>) {
    let Some(text) = read(dir, RECIPE_FILE) else { return (None, None) };
    match serde_json::from_str::<Recipe>(&text).map_err(|e| e.to_string()).and_then(check_recipe) {
        Ok(r) => (Some(r), None),
        Err(e) => (None, Some(e)),
    }
}

/// The tasks a project has: its recipe's, or the ones found in the folder when there is no recipe
pub fn tasks_of(dir: &Path) -> Vec<TaskSpec> {
    match load_recipe(dir).0 {
        Some(r) => r.tasks,
        None => detect(dir).tasks,
    }
}

/// The environment variables a project names: its recipe's, or the ones in its `.env.example`
pub fn env_of(dir: &Path) -> Vec<EnvVar> {
    match load_recipe(dir).0 {
        Some(r) => r.env,
        None => env_names(dir),
    }
}

/// The folders under `projects/`, and a Scratch entry when there are loose files beside them
pub fn list(workspace: &Path) -> Vec<ProjectInfo> {
    let root = workspace.join(PROJECTS_ROOT);
    let Ok(entries) = fs::read_dir(&root) else { return Vec::new() };
    let mut out = Vec::new();
    let mut loose = false;
    let mut rules = super::syncignore::Rules::load(workspace);
    for e in entries.filter_map(Result::ok) {
        let name = e.file_name().to_string_lossy().to_string();
        let Ok(kind) = e.file_type() else { continue };
        if name.starts_with('.') || rules.ignored(&format!("{PROJECTS_ROOT}/{name}"), kind.is_dir()) {
            continue;
        }
        if !kind.is_dir() {
            loose = true;
            continue;
        }
        let dir = e.path();
        let (recipe, recipe_error) = load_recipe(&dir);
        out.push(ProjectInfo {
            name: recipe.as_ref().map(|r| r.name.clone()).filter(|n| !n.is_empty()).unwrap_or_else(|| name.clone()),
            path: format!("{PROJECTS_ROOT}/{name}"),
            id: name,
            scratch: false,
            detected: detect(&dir),
            recipe,
            recipe_error,
        });
    }
    out.sort_by_key(|p| p.name.to_lowercase());
    if loose {
        out.insert(0, ProjectInfo { id: String::new(), path: PROJECTS_ROOT.to_string(), name: "Scratch".to_string(), scratch: true, detected: Detected { kinds: Vec::new(), package_manager: None, tasks: Vec::new(), tools: Vec::new(), env: Vec::new() }, recipe: None, recipe_error: None });
    }
    out
}

/// A project folder named by the caller, inside `projects/` and nowhere else
/// The problem matchers a project's recipe adds
pub fn matchers_of(dir: &Path) -> Vec<(MatcherSpec, regex::Regex)> {
    load_recipe(dir).0.map(|r| r.matchers.into_iter().filter_map(|m| compile_matcher(&m).ok().map(|re| (m, re))).collect()).unwrap_or_default()
}

pub(crate) fn project_dir(workspace: &str, project: &str) -> Result<PathBuf, String> {
    if project.is_empty() || project.contains(['/', '\\']) || project.starts_with('.') {
        return Err("That is not a project folder.".to_string());
    }
    let dir = resolve_workspace_path(workspace, &format!("{PROJECTS_ROOT}/{project}"))?;
    if !dir.is_dir() {
        return Err("That project folder does not exist.".to_string());
    }
    Ok(dir)
}

// ────────────────────────────
// Tauri commands
// ────────────────────────────

#[tauri::command]
pub fn projects_list(app_handle: tauri::AppHandle, path: String) -> Result<Vec<ProjectInfo>, String> {
    validate_allowed_root(&app_handle, &path)?;
    Ok(list(Path::new(&path)))
}

/// Saves the recipe in the project's folder, where the sync shares it with the team
#[tauri::command]
pub fn project_save_recipe(app_handle: tauri::AppHandle, path: String, project: String, recipe: Recipe) -> Result<Recipe, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dir = project_dir(&path, &project)?;
    let mut recipe = recipe;
    recipe.schema = RECIPE_SCHEMA;
    let recipe = check_recipe(recipe)?;
    let text = serde_json::to_string_pretty(&recipe).map_err(|e| e.to_string())?;
    fs::write(dir.join(RECIPE_FILE), format!("{text}\n")).map_err(|e| format!("Could not save the recipe: {e}"))?;
    Ok(recipe)
}

/// A new, empty project folder
#[tauri::command]
pub fn project_create(app_handle: tauri::AppHandle, path: String, name: String) -> Result<String, String> {
    validate_allowed_root(&app_handle, &path)?;
    let name = name.trim();
    super::helpers::validate_workspace_item_name(name)?;
    if name.starts_with('.') {
        return Err("A project's name cannot start with a dot.".to_string());
    }
    let dir = resolve_workspace_path(&path, PROJECTS_ROOT)?.join(name);
    if dir.exists() {
        return Err(format!("A project named \"{name}\" already exists."));
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(name.to_string())
}

/// Adds a line to the project's `.nexignore`, so the project's team stops syncing it
#[tauri::command]
pub fn project_add_ignore(app_handle: tauri::AppHandle, path: String, project: String, line: String) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    let dir = project_dir(&path, &project)?;
    let line = line.trim();
    if line.is_empty() || line.len() > 300 || line.contains(['\n', '\r', '\0']) {
        return Err("That is not a rule.".to_string());
    }
    let file = dir.join(super::syncignore::SHARED_FILE);
    let mut text = fs::read_to_string(&file).unwrap_or_default();
    if text.lines().any(|l| l.trim() == line) {
        return Ok(());
    }
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(line);
    text.push('\n');
    fs::write(file, text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
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
}

#[cfg(test)]
mod generated_projects {
    use super::*;

    /// Looks at the projects the templates really make. Run on purpose, with `NEXSYNC_TEMPLATE_DIR` set to a folder holding them:
    /// `NEXSYNC_TEMPLATE_DIR=... cargo test --lib looks_at_real_template_output -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn looks_at_real_template_output() {
        let Ok(dir) = std::env::var("NEXSYNC_TEMPLATE_DIR") else { return };
        for e in fs::read_dir(dir).unwrap().filter_map(Result::ok).filter(|e| e.path().is_dir()) {
            let d = detect(&e.path());
            println!("{}: kinds={:?} pm={:?}\n    tasks={:?}\n    tools={:?}", e.file_name().to_string_lossy(), d.kinds.iter().map(|k| k.id).collect::<Vec<_>>(), d.package_manager, d.tasks.iter().map(|t| format!("{}={}", t.id, t.command)).collect::<Vec<_>>(), d.tools.iter().map(|t| format!("{}{}", t.name, t.range)).collect::<Vec<_>>());
        }
    }
}
