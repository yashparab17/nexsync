//! Report files a test or coverage run leaves in a project (Phase 20, step 7): JUnit XML, Visual Studio's TRX, lcov and Cobertura.
//! They are found and read here and understood on the page. Only files inside the project are read, and only small ones.

use std::{fs, path::Path};

use serde::Serialize;

use super::project_dir;
use crate::commands::workspace::syncignore::PROJECTS_ROOT;
use crate::commands::{config::validate_allowed_root, path_utils::resolve_workspace_path};

const MAX_REPORT_BYTES: u64 = 8 * 1024 * 1024;
const MAX_DEPTH: usize = 4;
const MAX_FOUND: usize = 40;
/// Folders that are never looked into: they are large and hold other people's files, not this project's reports
const SKIP: &[&str] = &["node_modules", ".git", "target", ".venv", "venv", "__pycache__", "Pods", ".gradle", "vendor"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReportFile {
    /// Path inside the project
    pub path: String,
    /// `junit`, `trx`, `lcov` or `cobertura`
    pub kind: &'static str,
    pub size: u64,
    pub modified: u64,
}

/// What kind of report a file name says it is, or `None`
fn kind_of(name: &str, parent: &str) -> Option<&'static str> {
    let n = name.to_lowercase();
    if n.ends_with(".trx") {
        Some("trx")
    } else if n == "lcov.info" || n.ends_with(".lcov") {
        Some("lcov")
    } else if n == "cobertura.xml" || n == "cobertura-coverage.xml" || n == "coverage.xml" {
        Some("cobertura")
    } else if n.ends_with(".xml") && (n.starts_with("test-") || n.starts_with("junit") || n.contains("test-results") || n.contains("testresults") || n.contains("test-report") || (parent == "surefire-reports" && n.starts_with("test-"))) {
        Some("junit")
    } else {
        None
    }
}

fn walk(dir: &Path, rel: &str, depth: usize, out: &mut Vec<ReportFile>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let parent = rel.rsplit('/').next().unwrap_or("");
    for e in entries.filter_map(Result::ok) {
        if out.len() >= MAX_FOUND {
            return;
        }
        let Some(name) = e.file_name().to_str().map(str::to_owned) else { continue };
        let Ok(meta) = e.path().symlink_metadata() else { continue };
        let child = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        if meta.is_dir() && depth < MAX_DEPTH && !SKIP.contains(&name.as_str()) {
            walk(&e.path(), &child, depth + 1, out);
        } else if meta.is_file() && meta.len() <= MAX_REPORT_BYTES {
            if let Some(kind) = kind_of(&name, parent) {
                let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
                out.push(ReportFile { path: child, kind, size: meta.len(), modified });
            }
        }
    }
}

pub fn find_reports(dir: &Path) -> Vec<ReportFile> {
    let mut out = Vec::new();
    walk(dir, "", 0, &mut out);
    out.sort_by_key(|r| std::cmp::Reverse(r.modified));
    out
}

/// The test and coverage reports lying in a project, newest first
#[tauri::command(async)]
pub fn project_reports(app_handle: tauri::AppHandle, path: String, project: String) -> Result<Vec<ReportFile>, String> {
    validate_allowed_root(&app_handle, &path)?;
    Ok(find_reports(&project_dir(&path, &project)?))
}

/// The text of one of them; the path is inside the project and names a report
#[tauri::command(async)]
pub fn project_read_report(app_handle: tauri::AppHandle, path: String, project: String, file: String) -> Result<String, String> {
    validate_allowed_root(&app_handle, &path)?;
    let file = file.trim_matches('/');
    let name = file.rsplit('/').next().unwrap_or("");
    let parent = file.rsplit('/').nth(1).unwrap_or("");
    if file.split('/').any(|p| p == ".." || p.is_empty()) || kind_of(name, parent).is_none() {
        return Err("That is not a report file.".to_string());
    }
    let target = resolve_workspace_path(&path, &format!("{PROJECTS_ROOT}/{project}/{file}"))?;
    let meta = fs::metadata(&target).map_err(|_| "That report is gone.".to_string())?;
    if !meta.is_file() || meta.len() > MAX_REPORT_BYTES {
        return Err("That report is too big to read.".to_string());
    }
    fs::read_to_string(target).map_err(|_| "That report is not text.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_are_found_by_what_runners_name_them_and_nothing_else_is() {
        let dir = std::env::temp_dir().join(format!("nexsync-reports-{}", uuid::Uuid::new_v4()));
        for f in ["junit.xml", "coverage/lcov.info", "TestResults/run1.trx", "target/surefire-reports/TEST-a.xml", "build/test-results/test/TEST-b.xml", "pom.xml", "node_modules/x/lcov.info", "coverage.xml", "notes.xml"] {
            let p = dir.join(f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, "x").unwrap();
        }
        let mut found: Vec<_> = find_reports(&dir).into_iter().map(|r| (r.path, r.kind)).collect();
        found.sort();
        assert_eq!(found, [("TestResults/run1.trx".to_string(), "trx"), ("build/test-results/test/TEST-b.xml".to_string(), "junit"), ("coverage.xml".to_string(), "cobertura"), ("coverage/lcov.info".to_string(), "lcov"), ("junit.xml".to_string(), "junit")]);
        let _ = fs::remove_dir_all(dir);
    }
}
