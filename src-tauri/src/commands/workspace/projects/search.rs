//! Search and replace across a project (Phase 20, ideas): every line of every text file the project shares that matches, with the
//! files chosen before anything is changed. What the ignore rules keep on the device (`node_modules`, build output, `.env`) is
//! never searched, so a replace cannot touch it.

use std::{fs, io::Write, path::Path};

use regex::{Regex, RegexBuilder};
use serde::Serialize;

use super::project_dir;
use crate::commands::workspace::syncignore::{hidden_name_skipped, Rules, PROJECTS_ROOT};
use crate::commands::{config::validate_allowed_root, path_utils::resolve_workspace_path};

const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_FILES: usize = 20_000;
const MAX_MATCHES: usize = 1_000;
const MAX_DEPTH: usize = 12;
const LINE_WINDOW: usize = 400;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    /// Inside the project
    pub path: String,
    /// 1-based
    pub line: usize,
    /// The line, cut to a window around the match when it is very long
    pub text: String,
    /// Where the match is in `text`, in characters
    pub start: usize,
    pub end: usize,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub matches: Vec<Match>,
    /// Files that matched (the matches may stop at the limit before they are all listed)
    pub files: usize,
    pub truncated: bool,
}

pub fn pattern(query: &str, regex: bool, case_sensitive: bool) -> Result<Regex, String> {
    if query.is_empty() || query.len() > 500 {
        return Err("Type something to look for (up to 500 characters).".to_string());
    }
    let source = if regex { query.to_string() } else { regex::escape(query) };
    RegexBuilder::new(&source).case_insensitive(!case_sensitive).size_limit(512 * 1024).build().map_err(|e| format!("That is not a valid pattern: {}", e.to_string().lines().last().unwrap_or("")))
}

/// Text files only: a file with a zero byte in its first 8 KB is binary
fn text_of(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > MAX_FILE_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if bytes.iter().take(8192).any(|b| *b == 0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn matches_in(rel: &str, text: &str, re: &Regex, out: &mut Found) -> bool {
    let mut any = false;
    for (n, line) in text.lines().enumerate() {
        for m in re.find_iter(line) {
            // An empty match (a pattern such as `x*`) is no match worth showing
            if m.start() == m.end() {
                continue;
            }
            any = true;
            if out.matches.len() >= MAX_MATCHES {
                out.truncated = true;
                return any;
            }
            let (from, to) = (line[..m.start()].chars().count(), line[..m.end()].chars().count());
            let chars: Vec<char> = line.chars().collect();
            let lo = from.saturating_sub(LINE_WINDOW / 4).min(chars.len());
            let hi = (lo + LINE_WINDOW).min(chars.len()).max(to.min(chars.len()));
            out.matches.push(Match { path: rel.to_string(), line: n + 1, text: chars[lo..hi].iter().collect(), start: from - lo, end: to - lo });
        }
    }
    any
}

/// Matches in the files of a project that is under a workspace's `projects/` folder. `dir` is the project folder, `prefix` its path from the workspace.
pub fn search(workspace: &Path, dir: &Path, prefix: &str, re: &Regex) -> Found {
    let mut found = Found::default();
    let mut seen = 0usize;
    let mut rules = Rules::load(workspace);
    walk_prefixed(dir, &mut rules, prefix, &mut |rel, abs| {
        seen += 1;
        if seen > MAX_FILES || found.truncated {
            return false;
        }
        if let Some(text) = text_of(abs) {
            if matches_in(rel, &text, re, &mut found) {
                found.files += 1;
            }
        }
        true
    });
    found
}

fn walk_prefixed(dir: &Path, rules: &mut Rules, prefix: &str, visit: &mut dyn FnMut(&str, &Path) -> bool) {
    fn go(root: &Path, rules: &mut Rules, prefix: &str, rel: &str, depth: usize, visit: &mut dyn FnMut(&str, &Path) -> bool) -> bool {
        let dir = if rel.is_empty() { root.to_path_buf() } else { root.join(rel) };
        let Ok(rd) = fs::read_dir(&dir) else { return true };
        let mut entries: Vec<_> = rd.filter_map(Result::ok).collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let Some(name) = e.file_name().to_str().map(str::to_owned) else { continue };
            let Ok(meta) = e.path().symlink_metadata() else { continue };
            let inside = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            if meta.is_symlink() || hidden_name_skipped(PROJECTS_ROOT, &name) || rules.ignored(&format!("{prefix}/{inside}"), meta.is_dir()) {
                continue;
            }
            if meta.is_dir() {
                if depth < MAX_DEPTH && !go(root, rules, prefix, &inside, depth + 1, visit) {
                    return false;
                }
            } else if !visit(&inside, &e.path()) {
                return false;
            }
        }
        true
    }
    go(dir, rules, prefix, "", 0, visit);
}

#[tauri::command]
pub async fn project_search(app_handle: tauri::AppHandle, path: String, project: String, query: String, regex: bool, case_sensitive: bool) -> Result<Found, String> {
    validate_allowed_root(&app_handle, &path)?;
    let re = pattern(&query, regex, case_sensitive)?;
    let dir = project_dir(&path, &project)?;
    let workspace = std::path::PathBuf::from(&path);
    let prefix = format!("{PROJECTS_ROOT}/{project}");
    tokio::task::spawn_blocking(move || search(&workspace, &dir, &prefix, &re)).await.map_err(|e| e.to_string())
}

/// Replaces every match in the files named (paths inside the project, from a search); returns how many replacements were made
pub fn replace_in(workspace: &Path, dir: &Path, prefix: &str, re: &Regex, with: &str, literal: bool, files: &[String]) -> Result<usize, String> {
    let mut rules = Rules::load(workspace);
    let with = if literal { with.replace('$', "$$") } else { with.to_string() };
    let mut total = 0;
    for rel in files {
        if rel.is_empty() || rel.starts_with('/') || rel.split('/').any(|p| p.is_empty() || p == ".." || p == ".") || rel.contains('\\') {
            return Err(format!("\"{rel}\" is not a file of this project."));
        }
        if rules.ignored(&format!("{prefix}/{rel}"), false) || rel.split('/').any(|p| hidden_name_skipped(PROJECTS_ROOT, p)) {
            return Err(format!("\"{rel}\" is kept on this device and is not searched."));
        }
        let target = dir.join(rel);
        if fs::symlink_metadata(&target).map(|m| m.file_type().is_symlink() || !m.is_file()).unwrap_or(true) {
            continue;
        }
        let Some(text) = text_of(&target) else { continue };
        let count = re.find_iter(&text).filter(|m| m.start() != m.end()).count();
        if count == 0 {
            continue;
        }
        let out = re.replace_all(&text, with.as_str()).into_owned();
        // Written next to the file and moved over it, so a failure leaves the original
        let tmp = target.with_extension(format!("{}.nexsync-part", target.extension().and_then(|e| e.to_str()).unwrap_or("")));
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(out.as_bytes()).map_err(|e| e.to_string())?;
        drop(f);
        if let Ok(meta) = fs::metadata(&target) {
            let _ = fs::set_permissions(&tmp, meta.permissions());
        }
        fs::rename(&tmp, &target).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            e.to_string()
        })?;
        total += count;
    }
    Ok(total)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn project_replace(app_handle: tauri::AppHandle, path: String, project: String, query: String, regex: bool, case_sensitive: bool, replacement: String, files: Vec<String>) -> Result<usize, String> {
    validate_allowed_root(&app_handle, &path)?;
    if files.len() > 5_000 || replacement.len() > 5_000 {
        return Err("That is too much to replace at once.".to_string());
    }
    let re = pattern(&query, regex, case_sensitive)?;
    let dir = project_dir(&path, &project)?;
    for f in &files {
        resolve_workspace_path(&path, &format!("{PROJECTS_ROOT}/{project}/{f}"))?;
    }
    let workspace = std::path::PathBuf::from(&path);
    let prefix = format!("{PROJECTS_ROOT}/{project}");
    tokio::task::spawn_blocking(move || replace_in(&workspace, &dir, &prefix, &re, &replacement, !regex, &files)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project() -> (std::path::PathBuf, std::path::PathBuf) {
        let ws = std::env::temp_dir().join(format!("nexsync-search-{}", uuid::Uuid::new_v4()));
        let dir = ws.join("projects/app");
        for (f, t) in [
            ("src/a.ts", "const foo = 1;\nlet Foo = foo + foo;\n"),
            ("src/b.ts", "nothing here\n"),
            ("node_modules/x/index.js", "foo\n"),
            (".env", "foo=secret\n"),
            ("dist/out.js", "foo\n"),
        ] {
            let p = dir.join(f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, t).unwrap();
        }
        fs::write(dir.join("bin.dat"), b"foo\0foo").unwrap();
        (ws, dir)
    }

    #[test]
    fn only_what_the_project_shares_is_searched() {
        let (ws, dir) = project();
        let found = search(&ws, &dir, "projects/app", &pattern("foo", false, false).unwrap());
        // Case does not matter by default; dependencies, build output, .env and binary files are left alone
        assert_eq!((found.files, found.matches.len()), (1, 4));
        assert_eq!(found.matches[0], Match { path: "src/a.ts".into(), line: 1, text: "const foo = 1;".into(), start: 6, end: 9 });
        let exact = search(&ws, &dir, "projects/app", &pattern("foo", false, true).unwrap());
        assert_eq!(exact.matches.len(), 3);
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn a_pattern_that_is_not_valid_or_is_empty_is_refused_and_a_plain_search_is_not_a_pattern() {
        assert!(pattern("", false, false).is_err() && pattern("(", true, false).is_err());
        assert!(pattern("(", false, false).is_ok());
        assert!(pattern("a.c", false, true).unwrap().find("abc").is_none());
    }

    #[test]
    fn replacing_changes_only_the_files_named_and_keeps_dollars_in_a_plain_replacement() {
        let (ws, dir) = project();
        let re = pattern("foo", false, true).unwrap();
        let n = replace_in(&ws, &dir, "projects/app", &re, "$bar", true, &["src/a.ts".to_string()]).unwrap();
        assert_eq!(n, 3);
        assert_eq!(fs::read_to_string(dir.join("src/a.ts")).unwrap(), "const $bar = 1;\nlet Foo = $bar + $bar;\n");
        // Something the rules keep on the device, or outside the project, is refused
        assert!(replace_in(&ws, &dir, "projects/app", &re, "x", true, &[".env".to_string()]).is_err());
        assert!(replace_in(&ws, &dir, "projects/app", &re, "x", true, &["node_modules/x/index.js".to_string()]).is_err());
        assert!(replace_in(&ws, &dir, "projects/app", &re, "x", true, &["../secret".to_string()]).is_err());
        assert_eq!(fs::read_to_string(dir.join(".env")).unwrap(), "foo=secret\n");
        // A pattern may use groups in its replacement
        let re = pattern(r"let (\w+)", true, true).unwrap();
        assert_eq!(replace_in(&ws, &dir, "projects/app", &re, "var $1", false, &["src/a.ts".to_string()]).unwrap(), 1);
        assert!(fs::read_to_string(dir.join("src/a.ts")).unwrap().contains("var Foo"));
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn a_long_line_is_shown_around_its_match() {
        let line = format!("{}needle{}", "a".repeat(1000), "b".repeat(1000));
        let mut out = Found::default();
        matches_in("f", &line, &pattern("needle", false, true).unwrap(), &mut out);
        let m = &out.matches[0];
        assert!(m.text.chars().count() <= LINE_WINDOW + 6 && m.text.chars().skip(m.start).take(6).collect::<String>() == "needle");
    }
}
