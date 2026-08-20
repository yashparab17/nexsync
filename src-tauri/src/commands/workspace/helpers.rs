use std::fs;
use std::path::Path;

use crate::database::WorkspaceDb;
use tauri::Manager;

/// Returns the path to the workspace SQLite database file.
pub(crate) fn workspace_db_path(workspace_path: &Path) -> std::path::PathBuf {
    workspace_path.join(".nexsync").join("nexsync.db")
}

/// Returns the workspace id from the SQLite DB.
pub(crate) fn get_workspace_id(db: &WorkspaceDb) -> Result<String, String> {
    db.conn
        .query_row("SELECT id FROM workspace LIMIT 1", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

/// Returns the path to the workspace registry file in the app-data directory.
pub(crate) fn registry_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(app_data.join("nexsync").join("workspaces.json"))
}

/// Returns the path to the last-workspace file in the app-data directory.
pub(crate) fn last_workspace_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(app_data.join("nexsync").join("last_workspace.json"))
}

/// Ensures the registry directory exists and returns the registry path.
pub(crate) fn ensure_registry(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let path = registry_path(app_handle)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// Validates a workspace-relative path for safe filesystem access.
pub(crate) fn validate_workspace_rel_path(rel_path: &str) -> Result<(), String> {
    const ALLOWED_ROOTS: &[&str] = &["notes", "files", "assets", "tasks", "kanban", "editor"];
    let rel_path = rel_path.trim_matches('/');
    if rel_path.is_empty() {
        return Err("The path cannot be empty.".into());
    }
    let segments: Vec<&str> = rel_path.split('/').collect();
    if !ALLOWED_ROOTS.contains(&segments[0]) {
        return Err(format!("Invalid workspace path: {rel_path}"));
    }
    for segment in &segments {
        if segment.is_empty()
            || *segment == "."
            || *segment == ".."
            || segment.contains('\\')
            || segment.contains(':')
        {
            return Err(format!("Invalid path segment: {segment}"));
        }
    }
    Ok(())
}

/// Validates a single file/folder name for create/rename operations.
pub(crate) fn validate_workspace_item_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':')
    {
        return Err(format!("Invalid item name: {name}"));
    }
    Ok(())
}

/// Returns `true` if `path` points to a valid Nexsync workspace directory.
pub(crate) fn is_valid_workspace(path: &str) -> bool {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return false;
    }
    workspace_db_path(dir).exists()
}

/// Returns the path to the app-level error log in the app-data directory.
pub(crate) fn error_log_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(app_data.join("nexsync").join("errors.jsonl"))
}