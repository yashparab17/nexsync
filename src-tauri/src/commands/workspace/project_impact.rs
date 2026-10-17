//! Which tests a change can affect (Phase 20, ideas): the test files that, through the imports between files, reach a file changed since
//! the last passing run, or that changed themselves. JavaScript and TypeScript (relative imports and the common `@/` alias for
//! `src/`) and Python (relative imports and modules of the project) are read; for other languages the answer is "run everything".
//!
//! This is a guess made from the imports in the files, not from what a test really executed (a test can load a file by a path
//! built at run time, or through a plugin), so it lists what it skipped and the full run stays one press away.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
    time::UNIX_EPOCH,
};

use regex::Regex;
use serde::Serialize;

use super::{
    projects::project_dir,
    syncignore::{hidden_name_skipped, Rules, PROJECTS_ROOT},
};
use crate::commands::config::validate_allowed_root;

const MAX_FILES: usize = 20_000;
const MAX_FILE_BYTES: u64 = 512 * 1024;
const JS: &[&str] = &["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"];
/// A change to one of these can change every test
const EVERYTHING: &[&str] = &["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "tsconfig.json", "vite.config.ts", "vite.config.js", "vitest.config.ts", "vitest.config.js", "jest.config.js", "jest.config.ts", "pyproject.toml", "requirements.txt", "pytest.ini", "setup.cfg", "tox.ini", "conftest.py", "Cargo.toml", "go.mod", "nexsync.project.json"];

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Impact {
    /// `js`, `python` or `other`
    pub language: &'static str,
    /// Test files to run, inside the project
    pub tests: Vec<String>,
    /// Test files the change cannot reach
    pub skipped: usize,
    /// Files changed since the time asked about
    pub changed: Vec<String>,
    /// Everything should run: a settings file changed, or no passing run is known
    pub everything: bool,
    pub why: String,
}

pub fn is_test(rel: &str) -> bool {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    name.contains(".test.") || name.contains(".spec.") || (name.starts_with("test_") && name.ends_with(".py")) || name.ends_with("_test.py") || rel.split('/').any(|p| p == "__tests__")
}

fn import_re() -> Regex {
    Regex::new(r#"(?m)(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*|^\s*import\s+)['"]([^'"]+)['"]"#).unwrap()
}

/// Files a JS/TS file imports, as paths inside the project (only those that exist in `files`)
pub fn js_imports(rel: &str, text: &str, files: &HashSet<String>, re: &Regex) -> Vec<String> {
    let dir = rel.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let mut out = Vec::new();
    for c in re.captures_iter(text) {
        let spec = &c[1];
        let base = if let Some(rest) = spec.strip_prefix("@/") {
            format!("src/{rest}")
        } else if spec.starts_with('.') {
            normalise(&format!("{dir}/{spec}"))
        } else {
            continue;
        };
        // `./a` may be a.ts, a.tsx, a/index.ts, or a file written with its extension (or a .js name for a .ts file)
        let stem = base.trim_end_matches('/').to_string();
        let stripped = stem.rsplit_once('.').filter(|(_, e)| JS.contains(e)).map(|(s, _)| s.to_string());
        for b in std::iter::once(&stem).chain(stripped.as_ref()) {
            let hit = std::iter::once(b.clone()).chain(JS.iter().map(|e| format!("{b}.{e}"))).chain(JS.iter().map(|e| format!("{b}/index.{e}"))).find(|p| files.contains(p));
            if let Some(h) = hit {
                out.push(h);
                break;
            }
        }
    }
    out
}

fn normalise(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for p in path.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(p),
        }
    }
    parts.join("/")
}

/// Files a Python file imports that are in the project
pub fn py_imports(rel: &str, text: &str, files: &HashSet<String>) -> Vec<String> {
    let dir = rel.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let re = Regex::new(r"(?m)^\s*(?:from\s+(\.*)([\w.]*)\s+import\s+([\w, ]+)|import\s+([\w., ]+))").unwrap();
    let mut out = Vec::new();
    let mut add = |module: &str, base: &str| {
        let p = if base.is_empty() { module.replace('.', "/") } else { format!("{base}/{}", module.replace('.', "/")) };
        let p = normalise(&p);
        for cand in [format!("{p}.py"), format!("{p}/__init__.py"), format!("src/{p}.py"), format!("src/{p}/__init__.py")] {
            if files.contains(&cand) {
                out.push(cand);
                return;
            }
        }
    };
    for c in re.captures_iter(text) {
        if let Some(modules) = c.get(4) {
            for m in modules.as_str().split(',') {
                add(m.split_whitespace().next().unwrap_or(""), "");
            }
        } else {
            let dots = c.get(1).map_or(0, |d| d.as_str().len());
            let module = c.get(2).map_or("", |m| m.as_str());
            let base = if dots == 0 { String::new() } else { (1..dots).fold(dir.to_string(), |d, _| d.rsplit_once('/').map(|(p, _)| p.to_string()).unwrap_or_default()) };
            if !module.is_empty() {
                add(module, &base);
            }
            // `from . import name` and `from pkg import name` may name modules
            for name in c.get(3).map_or("", |n| n.as_str()).split(',') {
                let name = name.trim();
                if !name.is_empty() {
                    add(&if module.is_empty() { name.to_string() } else { format!("{module}.{name}") }, &base);
                }
            }
        }
    }
    out
}

struct Source {
    mtime: u64,
}

fn collect(workspace: &Path, dir: &Path, prefix: &str) -> HashMap<String, Source> {
    let mut out = HashMap::new();
    let mut rules = Rules::load(workspace);
    let mut stack = vec![String::new()];
    while let Some(rel) = stack.pop() {
        let Ok(rd) = fs::read_dir(if rel.is_empty() { dir.to_path_buf() } else { dir.join(&rel) }) else { continue };
        for e in rd.filter_map(Result::ok) {
            let Some(name) = e.file_name().to_str().map(str::to_owned) else { continue };
            let Ok(meta) = e.path().symlink_metadata() else { continue };
            let inside = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            if meta.is_symlink() || hidden_name_skipped(PROJECTS_ROOT, &name) || rules.ignored(&format!("{prefix}/{inside}"), meta.is_dir()) {
                continue;
            }
            if meta.is_dir() {
                if inside.matches('/').count() < 12 {
                    stack.push(inside);
                }
            } else if out.len() < MAX_FILES && meta.len() <= MAX_FILE_BYTES {
                let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
                out.insert(inside, Source { mtime });
            }
        }
    }
    out
}

/// The tests a change since `since` (milliseconds since 1970; 0 for no passing run known) can reach
pub fn impact(workspace: &Path, dir: &Path, prefix: &str, since: u64) -> Impact {
    let all = collect(workspace, dir, prefix);
    let names: HashSet<String> = all.keys().cloned().collect();
    let ext = |p: &str| p.rsplit_once('.').map(|(_, e)| e.to_string()).unwrap_or_default();
    let tests: Vec<String> = {
        let mut t: Vec<String> = all.keys().filter(|p| is_test(p) && (JS.contains(&ext(p).as_str()) || ext(p) == "py")).cloned().collect();
        t.sort();
        t
    };
    let language = if tests.iter().any(|t| ext(t) == "py") && !tests.iter().any(|t| JS.contains(&ext(t).as_str())) {
        "python"
    } else if tests.is_empty() {
        "other"
    } else {
        "js"
    };
    let mut changed: Vec<String> = all.iter().filter(|(_, s)| s.mtime > since).map(|(p, _)| p.clone()).collect();
    changed.sort();
    let mut result = Impact { language, changed: changed.clone(), ..Default::default() };
    if tests.is_empty() {
        result.everything = true;
        result.why = "No test files this can read (JavaScript, TypeScript and Python are read). Run the whole task.".to_string();
        return result;
    }
    if since == 0 {
        result.everything = true;
        result.tests = tests;
        result.why = "No passing run is known on this device, so everything runs.".to_string();
        return result;
    }
    if let Some(c) = changed.iter().find(|c| EVERYTHING.contains(&c.rsplit('/').next().unwrap_or(c))) {
        result.everything = true;
        result.tests = tests;
        result.why = format!("{c} changed, which can change every test.");
        return result;
    }
    // Who imports whom, then everything that reaches a changed file
    let re = import_re();
    let mut importers: HashMap<String, Vec<String>> = HashMap::new();
    for (rel, _) in all.iter().filter(|(p, _)| JS.contains(&ext(p).as_str()) || ext(p) == "py") {
        let Ok(text) = fs::read_to_string(dir.join(rel)) else { continue };
        let found = if ext(rel) == "py" { py_imports(rel, &text, &names) } else { js_imports(rel, &text, &names, &re) };
        for target in found {
            importers.entry(target).or_default().push(rel.clone());
        }
    }
    let mut reached: HashSet<String> = changed.iter().cloned().collect();
    let mut queue: Vec<String> = changed.clone();
    while let Some(f) = queue.pop() {
        for up in importers.get(&f).into_iter().flatten() {
            if reached.insert(up.clone()) {
                queue.push(up.clone());
            }
        }
    }
    let (run, skip): (Vec<String>, Vec<String>) = tests.into_iter().partition(|t| reached.contains(t));
    result.skipped = skip.len();
    result.tests = run;
    result.why = format!("{} changed since the last passing run.", if changed.len() == 1 { "1 file".to_string() } else { format!("{} files", changed.len()) });
    result
}

/// Which test files the changes since the last passing run can reach
#[tauri::command]
pub async fn project_test_impact(app_handle: tauri::AppHandle, path: String, project: String, since: u64) -> Result<Impact, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dir = project_dir(&path, &project)?;
    let workspace = std::path::PathBuf::from(&path);
    let prefix = format!("{PROJECTS_ROOT}/{project}");
    tokio::task::spawn_blocking(move || impact(&workspace, &dir, &prefix, since)).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    fn write(dir: &Path, rel: &str, text: &str, age_secs: u64) {
        let p = dir.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, text).unwrap();
        let f = fs::File::options().write(true).open(&p).unwrap();
        f.set_modified(SystemTime::now() - Duration::from_secs(age_secs)).unwrap();
    }

    fn since(secs_ago: u64) -> u64 {
        (SystemTime::now() - Duration::from_secs(secs_ago)).duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
    }

    #[test]
    fn a_test_is_affected_when_a_changed_file_is_reached_through_imports() {
        let ws = std::env::temp_dir().join(format!("nexsync-impact-{}", uuid::Uuid::new_v4()));
        let dir = ws.join("projects/app");
        // Old files (an hour ago), then one change a minute ago
        write(&dir, "src/util.ts", "export const u = 1;", 3600);
        write(&dir, "src/lib/math.ts", "export const m = 1;", 3600);
        write(&dir, "src/lib/index.ts", "export * from './math';", 3600);
        write(&dir, "src/a.ts", "import { u } from './util';", 3600);
        write(&dir, "src/b.ts", "import { m } from '@/lib';", 3600);
        write(&dir, "src/a.test.ts", "import { x } from './a';", 3600);
        write(&dir, "src/b.test.ts", "import { y } from './b.js';", 3600);
        write(&dir, "src/c.test.ts", "import 'node:fs';\nimport { z } from './c';", 3600);
        write(&dir, "src/c.ts", "export const z = 1;", 3600);
        write(&dir, "src/lib/math.ts", "export const m = 2;", 60);
        let r = impact(&ws, &dir, "projects/app", since(600));
        assert_eq!(r.changed, ["src/lib/math.ts"]);
        // math is reached by lib/index, by b, and by b.test; a and c are untouched
        assert_eq!(r.tests, ["src/b.test.ts"]);
        assert_eq!(r.skipped, 2);
        assert!(!r.everything);
        // A changed test is run itself
        write(&dir, "src/a.test.ts", "import { x } from './a';\n// edit", 30);
        assert_eq!(impact(&ws, &dir, "projects/app", since(600)).tests, ["src/a.test.ts", "src/b.test.ts"]);
        // A settings file means everything; no known passing run means everything too
        write(&dir, "package.json", "{}", 30);
        let r = impact(&ws, &dir, "projects/app", since(600));
        assert!(r.everything && r.tests.len() == 3 && r.why.contains("package.json"));
        assert!(impact(&ws, &dir, "projects/app", 0).everything);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn python_modules_are_followed_by_name_and_relative_imports() {
        let ws = std::env::temp_dir().join(format!("nexsync-impact-{}", uuid::Uuid::new_v4()));
        let dir = ws.join("projects/svc");
        write(&dir, "app/models.py", "x = 1", 3600);
        write(&dir, "app/__init__.py", "", 3600);
        write(&dir, "app/views.py", "from .models import x", 3600);
        write(&dir, "tests/test_views.py", "from app.views import y", 3600);
        write(&dir, "tests/test_other.py", "import os", 3600);
        write(&dir, "app/models.py", "x = 2", 60);
        let r = impact(&ws, &dir, "projects/svc", since(600));
        assert_eq!((r.language, r.tests, r.skipped), ("python", vec!["tests/test_views.py".to_string()], 1));
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn test_files_are_told_by_their_names() {
        for t in ["a.test.ts", "src/a.spec.tsx", "tests/test_x.py", "x_test.py", "src/__tests__/a.ts"] {
            assert!(is_test(t), "{t}");
        }
        for n in ["a.ts", "src/testing.ts", "contest.py"] {
            assert!(!is_test(n), "{n}");
        }
    }
}
