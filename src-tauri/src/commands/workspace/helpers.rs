//! Helper functions for workspace database access, registry management, and path validation.

use std::path::Path;
use crate::database::WorkspaceDb;
use tauri::Manager;

/// Returns the path to the workspace SQLite database file: `<workspace_path>/.nexsync/nexsync.db`
pub(crate) fn workspace_db_path(workspace_path: &Path) -> std::path::PathBuf {
    workspace_path.join(".nexsync").join("nexsync.db")
}

/// Returns the unique workspace id from the SQLite database
pub(crate) fn get_workspace_id(db: &WorkspaceDb) -> Result<String, String> {
    let mut stmt = db
        .conn
        .prepare("SELECT id FROM workspace")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: String = row.get(0).map_err(|e| e.to_string())?;
        if rows.next().map_err(|e| e.to_string())?.is_some() {
            return Err("Database integrity error: Multiple workspace records found in database.".to_string());
        }
        Ok(id)
    } else {
        Err("Workspace database does not contain a workspace record.".to_string())
    }
}

/// Returns the path to the workspace registry file in the app-data directory
pub(crate) fn registry_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(app_data.join("nexsync").join("workspaces.json"))
}

/// Returns the path to the last-workspace file in the app-data directory
pub(crate) fn last_workspace_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(app_data.join("nexsync").join("last_workspace.json"))
}

/// Ensures the registry directory exists and returns the registry path
pub(crate) fn ensure_registry(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let path = registry_path(app_handle)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// Validates a single file or folder name for create and rename operations
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

/// Returns true if path points to an existing valid Nexsync workspace
pub(crate) fn is_valid_workspace(path: &str) -> bool {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return false;
    }
    workspace_db_path(dir).exists()
}

/// Returns the path to the app-level error log in the app-data directory
pub(crate) fn error_log_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(app_data.join("nexsync").join("errors.jsonl"))
}