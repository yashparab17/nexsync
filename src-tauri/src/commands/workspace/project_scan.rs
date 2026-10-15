//! What to look at in a project before it is shared (Phase 20, step 1): folders that look like generated output, files too big
//! to sync, and paths that one operating system holds and another does not. Nothing here changes a file; the answers are
//! shown on the Projects page, where the person adds a rule to `.nexignore` or renames.

use std::{collections::HashMap, fs, path::Path};

use serde::Serialize;

use super::syncignore::{Rules, PROJECTS_ROOT};
use crate::commands::config::validate_allowed_root;

/// A folder with more files than this (or bytes), not already ignored, is probably generated
const HEAVY_FILES: usize = 3_000;
const HEAVY_BYTES: u64 = 300 * 1024 * 1024;
const MAX_ENTRIES: usize = 200_000;
const MAX_DEPTH: usize = 24;
const MAX_REPORTED: usize = 100;
/// Files looked into for secrets: small, and only so many, so a big project does not make the page wait
const SECRET_MAX_BYTES: u64 = 512 * 1024;
const SECRET_MAX_FILES: usize = 4_000;
/// Windows stops at 260 characters, and the workspace's own folder is already part of the path
const LONG_PATH: usize = 200;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Heavy {
    /// Workspace-relative folder
    pub path: String,
    pub files: usize,
    pub bytes: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Held {
    pub path: String,
    pub size: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Hazard {
    pub path: String,
    pub problem: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Secret {
    pub path: String,
    pub line: usize,
    pub kind: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Scan {
    /// Lines that look like a secret in files that would be shared
    pub secrets: Vec<Secret>,
    pub heavy: Vec<Heavy>,
    pub held: Vec<Held>,
    pub hazards: Vec<Hazard>,
    /// The scan stopped at its limit, so the lists may be incomplete
    pub truncated: bool,
}

const RESERVED: &[&str] = &["con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"];

/// What is wrong with a path for some other operating system, given every path in the project (case clashes need the rest)
pub fn path_problems(paths: &[String]) -> Vec<Hazard> {
    let mut out = Vec::new();
    let mut by_folder: HashMap<(String, String), Vec<&str>> = HashMap::new();
    for p in paths {
        let (folder, name) = p.rsplit_once('/').unwrap_or(("", p));
        by_folder.entry((folder.to_lowercase(), name.to_lowercase())).or_default().push(p);
        let stem = name.split('.').next().unwrap_or("").to_lowercase();
        let problem = if RESERVED.contains(&stem.as_str()) && !stem.is_empty() {
            Some("Windows cannot hold a file named like this")
        } else if name.ends_with('.') || name.ends_with(' ') {
            Some("Windows drops a trailing dot or space from a name")
        } else if name.chars().any(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') || c.is_control()) {
            Some("The name has a character Windows does not allow")
        } else if p.len() > LONG_PATH {
            Some("The path is long enough to hit Windows' limit of 260 characters")
        } else {
            None
        };
        if let Some(problem) = problem {
            out.push(Hazard { path: p.clone(), problem: problem.to_string() });
        }
    }
    for group in by_folder.values().filter(|g| g.len() > 1) {
        for p in group {
            out.push(Hazard { path: p.to_string(), problem: "Another file here differs from it only in capital letters; macOS and Windows treat them as one".to_string() });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out.truncate(MAX_REPORTED);
    out
}

struct Walk<'a> {
    workspace: &'a Path,
    rules: Rules,
    seen: usize,
    scan: Scan,
    paths: Vec<String>,
    looked: usize,
}

impl Walk<'_> {
    /// Walks one folder; returns its file count and bytes, and reports it when it is heavy (and not what it holds)
    fn folder(&mut self, rel: &str, depth: usize) -> (usize, u64) {
        let (mut files, mut bytes) = (0usize, 0u64);
        let heavy_mark = self.scan.heavy.len();
        let Ok(entries) = fs::read_dir(self.workspace.join(rel)) else { return (0, 0) };
        for e in entries.filter_map(Result::ok) {
            if self.seen >= MAX_ENTRIES {
                self.scan.truncated = true;
                break;
            }
            let Some(name) = e.file_name().to_str().map(str::to_owned) else { continue };
            let Ok(meta) = e.path().symlink_metadata() else { continue };
            if meta.is_symlink() {
                continue;
            }
            let child = format!("{rel}/{name}");
            if self.rules.ignored(&child, meta.is_dir()) {
                continue;
            }
            self.seen += 1;
            self.paths.push(child.clone());
            if meta.is_dir() {
                if depth < MAX_DEPTH {
                    let (f, b) = self.folder(&child, depth + 1);
                    files += f;
                    bytes += b;
                }
            } else if meta.is_file() {
                files += 1;
                bytes += meta.len();
                if meta.len() > super::syncignore::MAX_PROJECT_FILE_BYTES {
                    self.scan.held.push(Held { path: child, size: meta.len() });
                } else if meta.len() <= SECRET_MAX_BYTES && self.looked < SECRET_MAX_FILES && !super::secret_scan::is_example_file(&name) {
                    self.looked += 1;
                    if let Ok(bytes) = fs::read(e.path()) {
                        // Binary files are not text; a zero byte early on says so
                        if !bytes[..bytes.len().min(1024)].contains(&0) {
                            for f in super::secret_scan::scan_text(&String::from_utf8_lossy(&bytes)) {
                                self.scan.secrets.push(Secret { path: child.clone(), line: f.line, kind: f.kind.to_string() });
                            }
                        }
                    }
                }
            }
        }
        // Inside a project (not `projects/` or the project itself), a folder this big is reported once, in place of what is in it
        if depth >= 2 && (files >= HEAVY_FILES || bytes >= HEAVY_BYTES) {
            self.scan.heavy.truncate(heavy_mark);
            self.scan.heavy.push(Heavy { path: rel.to_string(), files, bytes });
        }
        (files, bytes)
    }
}

pub fn scan(workspace: &Path) -> Scan {
    let mut w = Walk { workspace, rules: Rules::load(workspace), seen: 0, scan: Scan::default(), paths: Vec::new(), looked: 0 };
    w.folder(PROJECTS_ROOT, 0);
    let mut scan = w.scan;
    scan.hazards = path_problems(&w.paths);
    scan.heavy.truncate(MAX_REPORTED);
    scan.held.truncate(MAX_REPORTED);
    scan.secrets.truncate(MAX_REPORTED);
    scan
}

/// Looks through `projects/` for folders that look generated, files held back for size and paths that will not work everywhere
#[tauri::command]
pub async fn project_scan(app_handle: tauri::AppHandle, path: String) -> Result<Scan, String> {
    validate_allowed_root(&app_handle, &path)?;
    tokio::task::spawn_blocking(move || scan(Path::new(&path))).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn paths_one_system_cannot_hold_are_flagged() {
        let found = path_problems(&paths(&["projects/a/con.txt", "projects/a/AUX", "projects/a/readme.md.", "projects/a/what?.md", "projects/a/ok.ts", "projects/a/Readme.md", "projects/a/README.md", "projects/b/Readme.md"]));
        let flagged: Vec<&str> = found.iter().map(|h| h.path.as_str()).collect();
        assert_eq!(flagged, ["projects/a/AUX", "projects/a/README.md", "projects/a/Readme.md", "projects/a/con.txt", "projects/a/readme.md.", "projects/a/what?.md"]);
        let long = format!("projects/a/{}.ts", "x".repeat(210));
        assert_eq!(path_problems(&[long]).len(), 1);
    }

    #[test]
    fn a_folder_of_generated_files_is_reported_in_place_of_what_is_inside_it() {
        let ws = std::env::temp_dir().join(format!("nexsync-scan-{}", uuid::Uuid::new_v4()));
        let gen = ws.join("projects/app/generated/deep");
        fs::create_dir_all(&gen).unwrap();
        for i in 0..HEAVY_FILES {
            fs::write(gen.join(format!("f{i}.ts")), "x").unwrap();
        }
        fs::create_dir_all(ws.join("projects/app/src")).unwrap();
        fs::write(ws.join("projects/app/src/main.ts"), "x").unwrap();
        fs::create_dir_all(ws.join("projects/app/node_modules/x")).unwrap();
        fs::write(ws.join("projects/app/node_modules/x/i.js"), "x").unwrap();
        let s = scan(&ws);
        assert_eq!(s.heavy.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(), ["projects/app/generated"]);
        assert_eq!(s.heavy[0].files, HEAVY_FILES);
        assert!(s.held.is_empty() && s.hazards.is_empty() && s.secrets.is_empty());
        let _ = fs::remove_dir_all(ws);
    }
}
