//! A project's environment on this device (Phase 20, step 4): the variables it needs, where this device keeps their values, and
//! whether the dependencies were installed from the files the project has now.
//!
//! Names and descriptions are shared (`.env.example` or the recipe). Values are not: they live in `.env` and `.env.local`, which
//! never leave the device, or in the operating system's credential store, and are put into a task's environment when it runs.
//! A value is never sent to the page; the page only learns whether one is set and where.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;

use super::projects::{env_of, project_dir, read, valid_name};
use crate::commands::config::validate_allowed_root;

const MAX_VALUE: usize = 8 * 1024;
const MAX_PAIRS: usize = 300;

// ────────────────────────────
// .env files
// ────────────────────────────

/// `NAME=value` lines: `export` allowed, values bare, in single quotes (as written) or double quotes (with \n, \", \\), comments and
/// blank lines ignored. No `${other}` expansion, which keeps the result the same on every system.
pub fn parse_env(text: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for line in text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((name, raw)) = line.strip_prefix("export ").unwrap_or(line).split_once('=') else { continue };
        let name = name.trim();
        if !valid_name(name) {
            continue;
        }
        let raw = raw.trim();
        let value = if let Some(inner) = raw.strip_prefix('"').and_then(|r| r.rfind('"').map(|i| &r[..i])) {
            let mut v = String::new();
            let mut chars = inner.chars();
            while let Some(c) = chars.next() {
                if c != '\\' {
                    v.push(c);
                    continue;
                }
                match chars.next() {
                    Some('n') => v.push('\n'),
                    Some(other) => v.push(other),
                    None => v.push('\\'),
                }
            }
            v
        } else if let Some(inner) = raw.strip_prefix('\'').and_then(|r| r.rfind('\'').map(|i| &r[..i])) {
            inner.to_string()
        } else {
            // A bare value ends at a comment that follows a space
            raw.split(" #").next().unwrap_or("").trim().to_string()
        };
        out.retain(|(n, _)| n != name);
        out.push((name.to_string(), value));
    }
    out
}

fn quote(value: &str) -> String {
    if !value.is_empty() && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/' | ':' | '@' | ',' | '+' | '=')) {
        value.to_string()
    } else {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    }
}

/// The text of a `.env` file with `name` set to `value` (or removed), every other line left as it was
pub fn set_in_env_text(text: &str, name: &str, value: Option<&str>) -> String {
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    let is_line = |l: &str| l.trim().strip_prefix("export ").unwrap_or(l.trim()).split_once('=').is_some_and(|(n, _)| n.trim() == name);
    let at = lines.iter().position(|l| is_line(l));
    match (at, value) {
        (Some(i), Some(v)) => lines[i] = format!("{name}={}", quote(v)),
        (Some(i), None) => {
            lines.remove(i);
        }
        (None, Some(v)) => lines.push(format!("{name}={}", quote(v))),
        (None, None) => {}
    }
    let mut out = lines.join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    out
}

/// What the files in the project folder set, `.env.local` over `.env`
fn file_values(dir: &Path) -> Vec<(String, String)> {
    let mut all: Vec<(String, String)> = Vec::new();
    for f in [".env", ".env.local"] {
        for (n, v) in parse_env(&read(dir, f).unwrap_or_default()) {
            all.retain(|(k, _)| *k != n);
            all.push((n, v));
        }
    }
    all
}

// ────────────────────────────
// The credential store
// ────────────────────────────

#[cfg(any(windows, target_os = "macos"))]
mod store {
    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new("nexsync-env", account).map_err(|e| e.to_string())
    }
    pub fn get(account: &str) -> Option<String> {
        entry(account).ok()?.get_password().ok()
    }
    pub fn set(account: &str, value: &str) -> Result<(), String> {
        entry(account)?.set_password(value).map_err(|e| format!("The credential store refused it: {e}"))
    }
    pub fn delete(account: &str) {
        if let Ok(e) = entry(account) {
            let _ = e.delete_credential();
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod store {
    pub fn get(_account: &str) -> Option<String> {
        None
    }
    pub fn set(_account: &str, _value: &str) -> Result<(), String> {
        Err("This system's credential store is not used. Keep the value in .env.".to_string())
    }
    pub fn delete(_account: &str) {}
}

fn account(workspace: &str, project: &str, name: &str) -> Result<String, String> {
    let db = crate::database::connection::WorkspaceDb::open_existing(workspace)?;
    Ok(format!("{}/{project}/{name}", super::helpers::get_workspace_id(&db)?))
}

/// The variables a task starts with: what the project's `.env` files set, over them the values kept in the credential store for
/// the names the project lists
pub fn values_for(workspace: &str, project: &str) -> Vec<(String, String)> {
    let Ok(dir) = project_dir(workspace, project) else { return Vec::new() };
    let mut all: HashMap<String, String> = file_values(&dir).into_iter().collect();
    for var in env_of(&dir) {
        if let Some(v) = account(workspace, project, &var.name).ok().and_then(|a| store::get(&a)) {
            all.insert(var.name, v);
        }
    }
    all.into_iter().filter(|(_, v)| v.len() <= MAX_VALUE).take(MAX_PAIRS).collect()
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct EnvState {
    pub name: String,
    pub description: String,
    /// `missing`, `file` (in `.env` on this device) or `credential` (in the operating system's store)
    pub state: &'static str,
}

#[tauri::command]
pub fn project_env_status(app_handle: tauri::AppHandle, path: String, project: String) -> Result<Vec<EnvState>, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dir = project_dir(&path, &project)?;
    let in_files: Vec<String> = file_values(&dir).into_iter().map(|(n, _)| n).collect();
    Ok(env_of(&dir)
        .into_iter()
        .map(|v| {
            let state = if account(&path, &project, &v.name).ok().and_then(|a| store::get(&a)).is_some() {
                "credential"
            } else if in_files.contains(&v.name) {
                "file"
            } else {
                "missing"
            };
            EnvState { name: v.name, description: v.description, state }
        })
        .collect())
}

/// Sets one variable on this device, in `.env` (`store` is `file`) or the credential store (`credential`); it leaves the other
#[tauri::command]
pub fn project_env_set(app_handle: tauri::AppHandle, path: String, project: String, name: String, value: String, store: String) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    let dir = project_dir(&path, &project)?;
    if !valid_name(&name) {
        return Err("That is not a variable name.".to_string());
    }
    if value.len() > MAX_VALUE || value.contains(['\n', '\r', '\0']) {
        return Err("A value is one line of up to 8,000 characters.".to_string());
    }
    let acct = account(&path, &project, &name)?;
    let file = dir.join(".env");
    let text = fs::read_to_string(&file).unwrap_or_default();
    match store.as_str() {
        "file" => {
            fs::write(&file, set_in_env_text(&text, &name, Some(&value))).map_err(|e| format!("Could not write .env: {e}"))?;
            store::delete(&acct);
        }
        "credential" => {
            store::set(&acct, &value)?;
            if text.lines().any(|l| l.contains(&name)) {
                fs::write(&file, set_in_env_text(&text, &name, None)).map_err(|e| e.to_string())?;
            }
        }
        _ => return Err("Choose where to keep it.".to_string()),
    }
    Ok(())
}

/// Removes one variable from this device, from both places
#[tauri::command]
pub fn project_env_clear(app_handle: tauri::AppHandle, path: String, project: String, name: String) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    let dir = project_dir(&path, &project)?;
    if !valid_name(&name) {
        return Err("That is not a variable name.".to_string());
    }
    store::delete(&account(&path, &project, &name)?);
    let file = dir.join(".env");
    if let Ok(text) = fs::read_to_string(&file) {
        fs::write(&file, set_in_env_text(&text, &name, None)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ────────────────────────────
// Dependencies
// ────────────────────────────

/// The files a package manager reads or writes to decide what is installed
const DEPENDENCY_FILES: &[&str] = &[
    "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "Cargo.toml", "Cargo.lock", "requirements.txt", "pyproject.toml", "poetry.lock", "uv.lock", "Pipfile", "Pipfile.lock",
    "go.mod", "go.sum", "pom.xml", "build.gradle", "build.gradle.kts", "gradle.lockfile", "Gemfile", "Gemfile.lock", "composer.json", "composer.lock", "pubspec.yaml", "pubspec.lock", "mix.exs", "mix.lock", "Package.swift", "Package.resolved",
    "packages.lock.json", "Directory.Packages.props",
];
const MAX_DEP_FILE: u64 = 4 * 1024 * 1024;

/// A fingerprint of the project's dependency files, and which of them there are
pub fn dependency_fingerprint(dir: &Path) -> (String, Vec<String>) {
    let mut names: Vec<String> = DEPENDENCY_FILES.iter().filter(|f| dir.join(f).is_file()).map(|f| f.to_string()).collect();
    if let Ok(rd) = fs::read_dir(dir) {
        names.extend(rd.filter_map(Result::ok).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.ends_with(".csproj") || n.ends_with(".fsproj")));
    }
    names.sort();
    let mut hasher = blake3::Hasher::new();
    for n in &names {
        hasher.update(n.as_bytes());
        hasher.update(&[0]);
        if fs::metadata(dir.join(n)).map(|m| m.len() <= MAX_DEP_FILE).unwrap_or(false) {
            hasher.update(&fs::read(dir.join(n)).unwrap_or_default());
        }
        hasher.update(&[0]);
    }
    (hasher.finalize().to_hex().to_string(), names)
}

fn deps_file(workspace: &str) -> PathBuf {
    Path::new(workspace).join(".nexsync").join("project-deps.json")
}

fn recorded(workspace: &str) -> HashMap<String, String> {
    fs::read_to_string(deps_file(workspace)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Remembers that this device installed from the files the project has now
pub fn mark_installed(workspace: &str, project: &str) {
    let Ok(dir) = project_dir(workspace, project) else { return };
    let mut all = recorded(workspace);
    all.insert(project.to_string(), dependency_fingerprint(&dir).0);
    let _ = fs::create_dir_all(Path::new(workspace).join(".nexsync"));
    if let Ok(text) = serde_json::to_string(&all) {
        let _ = fs::write(deps_file(workspace), text);
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct DepsStatus {
    /// `none` (no dependency files), `current`, `changed` (the files differ from when this device installed) or `never`
    pub state: &'static str,
    pub files: Vec<String>,
}

pub fn deps_state(workspace: &str, project: &str, dir: &Path) -> DepsStatus {
    let (now, files) = dependency_fingerprint(dir);
    let state = if files.is_empty() {
        "none"
    } else {
        match recorded(workspace).get(project) {
            None => "never",
            Some(h) if *h == now => "current",
            Some(_) => "changed",
        }
    };
    DepsStatus { state, files }
}

#[tauri::command]
pub fn project_deps_status(app_handle: tauri::AppHandle, path: String, project: String) -> Result<DepsStatus, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dir = project_dir(&path, &project)?;
    Ok(deps_state(&path, &project, &dir))
}

/// "I have installed them already": records the current files as what this device's install matches
#[tauri::command]
pub fn project_deps_mark(app_handle: tauri::AppHandle, path: String, project: String) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    project_dir(&path, &project)?;
    mark_installed(&path, &project);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_text_is_read_the_way_tools_read_it() {
        let got = parse_env("# a comment\nA=1\nexport B=two words # note\nC=\"quoted # not a comment\\nline\"\nD='raw $x'\nE=\nbad name=1\nA=3\n");
        let get = |n: &str| got.iter().find(|(k, _)| k == n).map(|(_, v)| v.as_str());
        assert_eq!((get("A"), get("B"), get("C"), get("D"), get("E"), get("bad name")), (Some("3"), Some("two words"), Some("quoted # not a comment\nline"), Some("raw $x"), Some(""), None));
    }

    #[test]
    fn setting_one_variable_leaves_every_other_line_alone() {
        let text = "# Database\nDB_URL=old\n\nOTHER=1\n";
        assert_eq!(set_in_env_text(text, "DB_URL", Some("new value")), "# Database\nDB_URL=\"new value\"\n\nOTHER=1\n");
        assert_eq!(set_in_env_text(text, "NEW", Some("x")), "# Database\nDB_URL=old\n\nOTHER=1\nNEW=x\n");
        assert_eq!(set_in_env_text(text, "OTHER", None), "# Database\nDB_URL=old\n\n");
        assert_eq!(parse_env(&set_in_env_text("", "Q", Some("a\"b\\c"))), [("Q".to_string(), "a\"b\\c".to_string())]);
    }

    #[test]
    fn a_change_to_a_lock_file_is_noticed_and_an_install_clears_it() {
        let ws = std::env::temp_dir().join(format!("nexsync-deps-{}", uuid::Uuid::new_v4()));
        let app = ws.join("projects/app");
        fs::create_dir_all(&app).unwrap();
        let w = ws.to_str().unwrap();
        assert_eq!(deps_state(w, "app", &app).state, "none");
        fs::write(app.join("package.json"), "{}").unwrap();
        fs::write(app.join("pnpm-lock.yaml"), "v1").unwrap();
        assert_eq!(deps_state(w, "app", &app).state, "never");
        mark_installed(w, "app");
        assert_eq!(deps_state(w, "app", &app).state, "current");
        fs::write(app.join("pnpm-lock.yaml"), "v2").unwrap();
        assert_eq!(deps_state(w, "app", &app), DepsStatus { state: "changed", files: vec!["package.json".into(), "pnpm-lock.yaml".into()] });
        mark_installed(w, "app");
        assert_eq!(deps_state(w, "app", &app).state, "current");
        let _ = fs::remove_dir_all(ws);
    }
}
