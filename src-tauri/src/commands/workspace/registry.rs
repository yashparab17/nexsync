//! Recent workspace tracking and last-opened workspace session restoration.

use std::fs;
use crate::commands::config::validate_allowed_root;
use super::helpers::{ensure_registry, is_valid_workspace, last_workspace_path};
use super::models::WorkspaceInfo;

const MAX_RECENT_WORKSPACES: usize = 20;

/// Checks if two path strings reference the same physical directory
pub(crate) fn is_same_path(p1: &str, p2: &str) -> bool {
    let s1 = p1.trim().trim_end_matches(['/', '\\']);
    let s2 = p2.trim().trim_end_matches(['/', '\\']);

    if s1.eq_ignore_ascii_case(s2) {
        return true;
    }

    match (std::path::Path::new(s1).canonicalize(), std::path::Path::new(s2).canonicalize()) {
        (Ok(c1), Ok(c2)) => {
            #[cfg(windows)]
            {
                c1.to_string_lossy().to_lowercase() == c2.to_string_lossy().to_lowercase()
            }
            #[cfg(not(windows))]
            {
                c1 == c2
            }
        }
        _ => s1.eq_ignore_ascii_case(s2),
    }
}

// ────────────────────────────
// Tauri commands — Recent workspaces registry
// ────────────────────────────

/// Retrieves the list of recent workspaces, filtering invalid paths, refreshing metadata, and deduplicating
#[tauri::command]
pub fn get_recent_workspaces(app_handle: tauri::AppHandle) -> Result<Vec<WorkspaceInfo>, String> {
    let registry = ensure_registry(&app_handle)?;
    if !registry.exists() {
        return Ok(vec![]);
    }
    let json = fs::read_to_string(&registry).map_err(|e| e.to_string())?;
    let raw_workspaces: Vec<WorkspaceInfo> = serde_json::from_str(&json)
        .map_err(|_| "Invalid workspaces registry.".to_string())?;

    let mut deduped: Vec<WorkspaceInfo> = Vec::new();

    for mut w in raw_workspaces {
        // Validate existence and security permissions
        if !is_valid_workspace(&w.path) || validate_allowed_root(&app_handle, &w.path).is_err() {
            continue;
        }

        // Refresh latest workspace name and description directly from SQLite if available
        if let Ok(db) = crate::database::WorkspaceDb::open_existing(&w.path) {
            if let Ok((fresh_id, fresh_name, fresh_desc)) = db.conn.query_row(
                "SELECT id, name, description FROM workspace LIMIT 1",
                [],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
            ) {
                w.id = fresh_id;
                w.name = fresh_name;
                w.description = fresh_desc;
            }
        }

        // Deduplicate: avoid duplicate cards for same ID or same path on disk
        if !deduped.iter().any(|existing| existing.id == w.id || is_same_path(&existing.path, &w.path)) {
            deduped.push(w);
        }
    }

    // Persist cleaned registry to disk
    let cleaned = serde_json::to_string_pretty(&deduped).map_err(|e| e.to_string())?;
    fs::write(&registry, cleaned).map_err(|e| e.to_string())?;

    Ok(deduped)
}

/// Retrieves the last opened workspace for startup session restoration
#[tauri::command]
pub fn get_last_workspace(app_handle: tauri::AppHandle) -> Result<Option<WorkspaceInfo>, String> {
    let path = last_workspace_path(&app_handle)?;
    if !path.exists() {
        return Ok(None);
    }
    let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let workspace: WorkspaceInfo = serde_json::from_str(&json)
        .map_err(|_| "Invalid last_workspace.json.".to_string())?;

    if !std::path::Path::new(&workspace.path).exists()
        || !is_valid_workspace(&workspace.path)
        || validate_allowed_root(&app_handle, &workspace.path).is_err()
    {
        return Ok(None);
    }
    Ok(Some(workspace))
}

/// Persists the last active workspace record
#[tauri::command]
pub fn set_last_workspace(
    app_handle: tauri::AppHandle,
    workspace: WorkspaceInfo,
) -> Result<(), String> {
    validate_allowed_root(&app_handle, &workspace.path)?;

    if workspace.name.len() > 256 || workspace.description.len() > 1024 || workspace.path.len() > 1024 {
        return Err("Workspace metadata exceeds maximum field length.".to_string());
    }

    let path = last_workspace_path(&app_handle)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&workspace).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Clears the last active workspace record
#[tauri::command]
pub fn clear_last_workspace(app_handle: tauri::AppHandle) -> Result<(), String> {
    let path = last_workspace_path(&app_handle)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Adds or moves a workspace to the top of the recent workspaces registry, deduplicating by ID and path
#[tauri::command]
pub fn add_recent_workspace(
    app_handle: tauri::AppHandle,
    workspace: WorkspaceInfo,
) -> Result<(), String> {
    validate_allowed_root(&app_handle, &workspace.path)?;

    if workspace.name.len() > 256 || workspace.description.len() > 1024 || workspace.path.len() > 1024 {
        return Err("Workspace metadata exceeds maximum field length.".to_string());
    }

    let registry = ensure_registry(&app_handle)?;
    let mut workspaces: Vec<WorkspaceInfo> = if registry.exists() {
        let json = fs::read_to_string(&registry).map_err(|e| e.to_string())?;
        serde_json::from_str(&json).unwrap_or_default()
    } else {
        vec![]
    };

    // Remove any entry matching either the ID or the same physical path
    workspaces.retain(|w| w.id != workspace.id && !is_same_path(&w.path, &workspace.path));
    workspaces.insert(0, workspace);
    workspaces.truncate(MAX_RECENT_WORKSPACES);

    let json = serde_json::to_string_pretty(&workspaces).map_err(|e| e.to_string())?;
    fs::write(&registry, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Removes a workspace by ID or path from the recent workspaces registry
#[tauri::command]
pub fn remove_recent_workspace(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let registry = ensure_registry(&app_handle)?;
    let mut workspaces: Vec<WorkspaceInfo> = if registry.exists() {
        let json = fs::read_to_string(&registry).map_err(|e| e.to_string())?;
        serde_json::from_str(&json).unwrap_or_default()
    } else {
        vec![]
    };

    workspaces.retain(|w| w.id != id && !is_same_path(&w.path, &id));
    let json = serde_json::to_string_pretty(&workspaces).map_err(|e| e.to_string())?;
    fs::write(&registry, json).map_err(|e| e.to_string())?;
    Ok(())
}