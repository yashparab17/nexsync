//! New projects from the tools each ecosystem already has (Phase 20, step 6), and existing folders brought in as projects.
//!
//! A template is a row of data: the program that makes the project, the command with places for the name and a few choices, and the
//! tools it needs. The command is built here from values checked against fixed lists (and a name of letters, digits, `-` and `_`),
//! so what runs is exactly what the dialog showed, and the person's choice to create is the approval. Nexsync adds nothing to the
//! files these tools generate.

use std::{fs, path::Path};

use serde::Serialize;
use tauri::{AppHandle, State};

use super::{
    tasks::{launch, TaskState},
    TaskSpec,
};
use crate::commands::workspace::syncignore::{always_blocked, Rules, PROJECTS_ROOT};
use crate::commands::{config::validate_allowed_root, path_utils::resolve_workspace_path};

#[derive(Serialize, Clone)]
pub struct Choice {
    pub value: &'static str,
    pub label: &'static str,
}

#[derive(Serialize, Clone)]
pub struct Field {
    pub id: &'static str,
    pub label: &'static str,
    pub choices: &'static [Choice],
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: &'static str,
    pub label: &'static str,
    pub group: &'static str,
    /// What it makes, in a few words
    pub about: &'static str,
    pub fields: &'static [Field],
    /// The programs it needs, as the Doctor names them
    pub requires: &'static [&'static str],
    /// The command, with `{name}` and a `{field}` for each field
    #[serde(skip)]
    command: &'static str,
}

macro_rules! choices {
    ($(($v:expr, $l:expr)),* $(,)?) => { &[$(Choice { value: $v, label: $l }),*] };
}

const VITE: &[Choice] = choices![("vanilla", "JavaScript"), ("vanilla-ts", "TypeScript"), ("react", "React"), ("react-ts", "React and TypeScript"), ("vue", "Vue"), ("vue-ts", "Vue and TypeScript"), ("svelte", "Svelte"), ("svelte-ts", "Svelte and TypeScript"), ("preact", "Preact"), ("preact-ts", "Preact and TypeScript"), ("lit", "Lit"), ("solid", "Solid"), ("solid-ts", "Solid and TypeScript")];
const LANG: &[Choice] = choices![("ts", "TypeScript"), ("js", "JavaScript")];
const ASTRO: &[Choice] = choices![("basics", "Basics"), ("blog", "Blog"), ("minimal", "Minimal")];
const EXPO: &[Choice] = choices![("blank", "Blank"), ("blank-typescript", "Blank and TypeScript"), ("tabs", "Tabs")];
const TAURI: &[Choice] = choices![("react-ts", "React and TypeScript"), ("vue-ts", "Vue and TypeScript"), ("svelte-ts", "Svelte and TypeScript"), ("solid-ts", "Solid and TypeScript"), ("vanilla-ts", "TypeScript")];
const CARGO: &[Choice] = choices![("bin", "Program"), ("lib", "Library")];
const DOTNET: &[Choice] = choices![("console", "Console app"), ("webapi", "Web API"), ("mvc", "Web app (MVC)"), ("blazor", "Blazor app"), ("classlib", "Class library"), ("xunit", "xUnit tests"), ("worker", "Worker service")];
const SVELTEKIT: &[Choice] = choices![("minimal", "Minimal"), ("demo", "Demo"), ("library", "Library")];

const TEMPLATES: &[Template] = &[
    Template { id: "vite", label: "Vite", group: "Web", about: "A front-end app with fast reloads", fields: &[Field { id: "template", label: "Starter", choices: VITE }], requires: &["node", "npm"], command: "npm create --yes vite@latest {name} -- --template {template}" },
    Template { id: "next", label: "Next.js", group: "Web", about: "A React framework with server rendering", fields: &[Field { id: "lang", label: "Language", choices: LANG }], requires: &["node", "npm"], command: "npx --yes create-next-app@latest {name} --{lang} --eslint --app --use-npm --skip-install --no-tailwind --no-src-dir --import-alias \"@/*\"" },
    Template { id: "astro", label: "Astro", group: "Web", about: "A content site that ships little JavaScript", fields: &[Field { id: "template", label: "Starter", choices: ASTRO }], requires: &["node", "npm"], command: "npm create --yes astro@latest {name} -- --template {template} --no-install --no-git --yes" },
    Template { id: "sveltekit", label: "SvelteKit", group: "Web", about: "A Svelte framework for apps and sites", fields: &[Field { id: "template", label: "Starter", choices: SVELTEKIT }], requires: &["node", "npm"], command: "npx --yes sv create {name} --template {template} --types ts --no-add-ons --no-install" },
    Template { id: "docusaurus", label: "Docusaurus", group: "Docs", about: "A documentation site", fields: &[], requires: &["node", "npm"], command: "npx --yes create-docusaurus@latest {name} classic --typescript --skip-install" },
    Template { id: "expo", label: "Expo", group: "Mobile", about: "A React Native app", fields: &[Field { id: "template", label: "Starter", choices: EXPO }], requires: &["node", "npm"], command: "npx --yes create-expo-app@latest {name} --template {template} --no-install" },
    Template { id: "flutter", label: "Flutter", group: "Mobile", about: "A mobile and desktop app in Dart", fields: &[], requires: &["flutter"], command: "flutter create {name}" },
    Template { id: "tauri", label: "Tauri", group: "Desktop", about: "A desktop app with a web interface and a Rust core", fields: &[Field { id: "template", label: "Front end", choices: TAURI }], requires: &["node", "npm", "cargo"], command: "npm create --yes tauri-app@latest {name} -- --template {template} --manager npm --yes" },
    Template { id: "cargo", label: "Rust", group: "Rust", about: "A Cargo package", fields: &[Field { id: "kind", label: "Kind", choices: CARGO }], requires: &["cargo"], command: "cargo new {name} --{kind}" },
    Template { id: "go", label: "Go", group: "Go", about: "A Go module", fields: &[], requires: &["go"], command: "mkdir {name} && cd {name} && go mod init {name}" },
    Template { id: "django", label: "Django", group: "Python", about: "A Django project", fields: &[], requires: &["python"], command: "django-admin startproject {name}" },
    Template { id: "uv", label: "Python with uv", group: "Python", about: "A Python project managed by uv", fields: &[], requires: &["uv"], command: "uv init {name}" },
    Template { id: "poetry", label: "Python with Poetry", group: "Python", about: "A Python package managed by Poetry", fields: &[], requires: &["poetry"], command: "poetry new {name}" },
    Template { id: "dotnet", label: ".NET", group: ".NET", about: "A project from the dotnet templates", fields: &[Field { id: "template", label: "Kind", choices: DOTNET }], requires: &["dotnet"], command: "dotnet new {template} -n {name} -o {name}" },
    Template { id: "rails", label: "Rails", group: "Ruby", about: "A Rails app", fields: &[], requires: &["ruby", "bundler"], command: "rails new {name}" },
    Template { id: "laravel", label: "Laravel", group: "PHP", about: "A Laravel app", fields: &[], requires: &["php", "composer"], command: "composer create-project laravel/laravel {name}" },
    Template { id: "phoenix", label: "Phoenix", group: "Elixir", about: "A Phoenix app", fields: &[], requires: &["elixir"], command: "mix phx.new {name} --no-install" },
    Template { id: "mkdocs", label: "MkDocs", group: "Docs", about: "A documentation site from Markdown", fields: &[], requires: &["python"], command: "mkdocs new {name}" },
    Template { id: "hugo", label: "Hugo", group: "Docs", about: "A static site", fields: &[], requires: &[], command: "hugo new site {name}" },
];

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 60 && name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The command a template makes for a name and the choices (one value per field, each from the field's list)
pub fn build_command(template: &str, name: &str, options: &[(String, String)]) -> Result<String, String> {
    let t = TEMPLATES.iter().find(|t| t.id == template).ok_or("That is not a template.")?;
    if !valid_name(name) {
        return Err("A project name is letters, digits, - and _, and starts with a letter or digit.".to_string());
    }
    let mut command = t.command.replace("{name}", name);
    for f in t.fields {
        let value = options.iter().find(|(k, _)| k == f.id).map(|(_, v)| v.as_str()).unwrap_or_else(|| f.choices[0].value);
        if !f.choices.iter().any(|c| c.value == value) {
            return Err(format!("\"{value}\" is not a choice for {}.", f.label));
        }
        command = command.replace(&format!("{{{}}}", f.id), value);
    }
    Ok(command)
}

#[tauri::command]
pub fn project_templates() -> Vec<Template> {
    TEMPLATES.to_vec()
}

/// What a template would run, for the dialog to show before anything starts
#[tauri::command]
pub fn project_scaffold_preview(template: String, name: String, options: Vec<(String, String)>) -> Result<String, String> {
    build_command(&template, &name, &options)
}

/// Runs a template in the projects folder; its output streams like a task's, under the new project's name
#[tauri::command]
pub async fn project_scaffold(app: AppHandle, state: State<'_, TaskState>, path: String, template: String, name: String, options: Vec<(String, String)>) -> Result<String, String> {
    validate_allowed_root(&app, &path)?;
    let command = build_command(&template, &name, &options)?;
    let root = resolve_workspace_path(&path, PROJECTS_ROOT)?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    if root.join(&name).exists() {
        return Err(format!("A project named \"{name}\" already exists."));
    }
    let task = TaskSpec { id: "create".into(), label: "Create".into(), command: command.clone(), ..Default::default() };
    Ok(launch(&app, &state, path, name, task, command, root))
}

// ────────────────────────────
// Importing a folder as a project
// ────────────────────────────

const MAX_IMPORT_FILES: usize = 100_000;
const MAX_IMPORT_BYTES: u64 = 5 * 1024 * 1024 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Left {
    /// Path inside the folder
    pub path: String,
    pub folder: bool,
    pub files: usize,
    pub bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct ImportPreview {
    pub files: usize,
    pub bytes: u64,
    /// What the project's rules keep on the device: dependencies, build output, local environment files
    pub left: Vec<Left>,
    pub scan: super::scan::Scan,
}

fn size_of(path: &Path, budget: &mut usize) -> (usize, u64) {
    let Ok(meta) = path.symlink_metadata() else { return (0, 0) };
    if meta.is_symlink() {
        return (0, 0);
    }
    if meta.is_file() {
        return (1, meta.len());
    }
    let (mut files, mut bytes) = (0, 0);
    if let Ok(rd) = fs::read_dir(path) {
        for e in rd.filter_map(Result::ok) {
            if *budget == 0 {
                break;
            }
            *budget -= 1;
            let (f, b) = size_of(&e.path(), budget);
            files += f;
            bytes += b;
        }
    }
    (files, bytes)
}

/// The prefix a folder outside the workspace is looked at under, so the project rules apply to it as they will once it is in
const MOUNT: &str = "projects/import";

fn mounted_rules(workspace: &Path, source: &Path) -> Rules {
    Rules::mounted(workspace, MOUNT, source)
}

pub fn preview_folder(workspace: &Path, source: &Path) -> ImportPreview {
    let scan = super::scan::scan_mounted(workspace, MOUNT, source);
    let mut rules = mounted_rules(workspace, source);
    let mut left = Vec::new();
    let (mut files, mut bytes) = (0usize, 0u64);
    // The top level of what is kept back is enough to explain the rest: a folder is listed once, not file by file
    fn visit(dir: &Path, rel: &str, rules: &mut Rules, left: &mut Vec<Left>, files: &mut usize, bytes: &mut u64, depth: usize) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        for e in rd.filter_map(Result::ok) {
            let Some(name) = e.file_name().to_str().map(str::to_owned) else { continue };
            let Ok(meta) = e.path().symlink_metadata() else { continue };
            if meta.is_symlink() {
                continue;
            }
            let child = format!("{rel}/{name}");
            if always_blocked(&child) {
                continue;
            }
            if rules.ignored(&child, meta.is_dir()) {
                if left.len() < 60 {
                    let (f, b) = size_of(&e.path(), &mut 200_000);
                    left.push(Left { path: child[MOUNT.len() + 1..].to_string(), folder: meta.is_dir(), files: f, bytes: b });
                }
            } else if meta.is_dir() && depth < 24 {
                visit(&e.path(), &child, rules, left, files, bytes, depth + 1);
            } else if meta.is_file() {
                *files += 1;
                *bytes += meta.len();
            }
        }
    }
    visit(source, MOUNT, &mut rules, &mut left, &mut files, &mut bytes, 0);
    ImportPreview { files, bytes, left, scan }
}

/// What a folder would bring into a workspace, before anything is copied
#[tauri::command]
pub async fn project_import_preview(app_handle: AppHandle, path: String, source: String) -> Result<ImportPreview, String> {
    validate_allowed_root(&app_handle, &path)?;
    let source = std::path::PathBuf::from(&source);
    if !source.is_dir() {
        return Err("Choose a folder.".to_string());
    }
    tokio::task::spawn_blocking(move || preview_folder(Path::new(&path), &source)).await.map_err(|e| e.to_string())
}

fn copy_tree(from: &Path, to: &Path, rel: &str, rules: &mut Rules, keep_all: bool, count: &mut usize, bytes: &mut u64) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for e in fs::read_dir(from).map_err(|e| e.to_string())?.filter_map(Result::ok) {
        let Some(name) = e.file_name().to_str().map(str::to_owned) else { continue };
        let Ok(meta) = e.path().symlink_metadata() else { continue };
        let child = format!("{rel}/{name}");
        // Links are not followed or copied, and Git's folder is the one thing that is never copied (Phase 21 deals with Git)
        if meta.is_symlink() || always_blocked(&child) || (!keep_all && rules.ignored(&child, meta.is_dir())) {
            continue;
        }
        if meta.is_dir() {
            copy_tree(&e.path(), &to.join(&name), &child, rules, keep_all, count, bytes)?;
        } else if meta.is_file() {
            *count += 1;
            *bytes += meta.len();
            if *count > MAX_IMPORT_FILES || *bytes > MAX_IMPORT_BYTES {
                return Err("That folder is too big to import in one go. Leave dependencies and build output behind, or import part of it.".to_string());
            }
            fs::copy(e.path(), to.join(&name)).map_err(|err| format!("Could not copy {child}: {err}"))?;
        }
    }
    Ok(())
}

/// Copies a folder into `projects/<name>`; `skip_kept` leaves behind what the project's rules keep on a device (the usual choice)
#[tauri::command]
pub async fn project_import(app_handle: AppHandle, path: String, source: String, name: String, skip_kept: bool) -> Result<usize, String> {
    validate_allowed_root(&app_handle, &path)?;
    if !valid_name(&name) {
        return Err("A project name is letters, digits, - and _, and starts with a letter or digit.".to_string());
    }
    let source = std::path::PathBuf::from(&source).canonicalize().map_err(|_| "That folder cannot be read.".to_string())?;
    let workspace = Path::new(&path).canonicalize().map_err(|e| e.to_string())?;
    if source.starts_with(&workspace) {
        return Err("That folder is already inside this workspace.".to_string());
    }
    let dest = resolve_workspace_path(&path, &format!("{PROJECTS_ROOT}/{name}"))?;
    if dest.exists() {
        return Err(format!("A project named \"{name}\" already exists."));
    }
    tokio::task::spawn_blocking(move || {
        let mut rules = mounted_rules(&workspace, &source);
        let (mut count, mut bytes) = (0, 0);
        let result = copy_tree(&source, &dest, MOUNT, &mut rules, !skip_kept, &mut count, &mut bytes);
        if result.is_err() {
            let _ = fs::remove_dir_all(&dest);
        }
        result.map(|_| count)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn a_command_is_built_from_a_name_and_checked_choices() {
        assert_eq!(build_command("vite", "web", &opts(&[("template", "react-ts")])).unwrap(), "npm create --yes vite@latest web -- --template react-ts");
        assert_eq!(build_command("vite", "web", &[]).unwrap(), "npm create --yes vite@latest web -- --template vanilla", "the first choice is the default");
        assert_eq!(build_command("go", "tool", &[]).unwrap(), "mkdir tool && cd tool && go mod init tool");
        assert_eq!(build_command("cargo", "lib-a", &opts(&[("kind", "lib")])).unwrap(), "cargo new lib-a --lib");
    }

    #[test]
    fn nothing_but_a_plain_name_and_listed_choices_reaches_the_command() {
        for bad in ["", "a b", "a;rm -rf", "a&&b", "$(x)", "../x", "-flag", "a\"b", "a/b"] {
            assert!(build_command("cargo", bad, &[]).is_err(), "{bad:?}");
        }
        assert!(build_command("vite", "web", &opts(&[("template", "react; calc")])).is_err());
        assert!(build_command("nope", "web", &[]).is_err());
        for t in TEMPLATES {
            let c = build_command(t.id, "demo", &[]).unwrap();
            assert!(!c.contains('{'), "{} leaves a place unfilled: {c}", t.id);
        }
    }

    #[test]
    fn every_template_is_listed_once_with_a_choice_to_start_from() {
        let mut ids: Vec<_> = TEMPLATES.iter().map(|t| t.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), TEMPLATES.len());
        assert!(TEMPLATES.iter().all(|t| t.fields.iter().all(|f| !f.choices.is_empty())));
    }

    #[test]
    fn a_folder_from_outside_is_looked_at_with_the_project_rules() {
        let ws = std::env::temp_dir().join(format!("nexsync-import-ws-{}", uuid::Uuid::new_v4()));
        let src = std::env::temp_dir().join(format!("nexsync-import-src-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&ws).unwrap();
        for (f, text) in [("src/main.ts", "export {};"), ("package.json", "{}"), (".gitignore", "secret-notes/\n"), ("secret-notes/a.md", "x"), ("node_modules/a/i.js", "x"), (".git/config", "x"), (".env", "A=1"), (".env.example", "A=")] {
            let p = src.join(f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, text).unwrap();
        }
        let p = preview_folder(&ws, &src);
        assert_eq!(p.files, 4, "main.ts, package.json, .gitignore and .env.example");
        let mut left: Vec<_> = p.left.iter().map(|l| l.path.as_str()).collect();
        left.sort();
        assert_eq!(left, [".env", "node_modules", "secret-notes"]);
        // Copying with the rules leaves the same things behind, and never copies Git's folder
        let dest = ws.join("projects/imp");
        let mut rules = mounted_rules(&ws.canonicalize().unwrap(), &src);
        let (mut n, mut b) = (0, 0);
        copy_tree(&src, &dest, MOUNT, &mut rules, false, &mut n, &mut b).unwrap();
        assert_eq!(n, 4);
        assert!(dest.join("src/main.ts").is_file() && !dest.join("node_modules").exists() && !dest.join(".git").exists() && !dest.join(".env").exists());
        let all = ws.join("projects/all");
        let (mut n, mut b) = (0, 0);
        copy_tree(&src, &all, MOUNT, &mut rules, true, &mut n, &mut b).unwrap();
        assert!(all.join("node_modules/a/i.js").is_file() && !all.join(".git").exists(), "everything but Git's folder");
        let _ = fs::remove_dir_all(ws);
        let _ = fs::remove_dir_all(src);
    }
}
