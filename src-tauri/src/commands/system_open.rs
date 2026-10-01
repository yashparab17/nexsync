//! Opening a workspace file in the app the operating system uses for that file type.

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::commands::{config::validate_allowed_root, path_utils::resolve_workspace_path};

/// Files a collaborator could sync that would run code, not show a document, if the system opened them
const RUNNABLE: &[&str] = &[
    "exe", "msi", "bat", "cmd", "com", "scr", "lnk", "ps1", "vbs", "vbe", "js", "jse", "wsf", "hta", "jar", "reg", "cpl", "msc", "app",
    "command", "sh", "desktop", "appimage", "dmg", "pkg",
];

fn is_runnable(path: &std::path::Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| RUNNABLE.contains(&e.to_ascii_lowercase().as_str()))
}

/// Opens a workspace file, such as a Word document, in the system's default app
#[tauri::command]
pub fn open_workspace_file(app: AppHandle, workspace_path: String, rel_path: String) -> Result<(), String> {
    validate_allowed_root(&app, &workspace_path)?;
    let path = resolve_workspace_path(&workspace_path, &rel_path)?;
    if !path.is_file() {
        return Err("That file no longer exists.".to_string());
    }
    if is_runnable(&path) {
        return Err("For safety, programs and scripts can't be opened from here.".to_string());
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Could not open the file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::is_runnable;
    use std::path::Path;

    #[test]
    fn blocks_programs_but_not_documents() {
        assert!(is_runnable(Path::new("assets/Setup.EXE")));
        assert!(is_runnable(Path::new("files/run.bat")));
        assert!(!is_runnable(Path::new("files/report.docx")));
        assert!(!is_runnable(Path::new("files/noext")));
    }
}
