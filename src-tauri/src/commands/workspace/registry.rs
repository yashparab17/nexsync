//! Recent workspace tracking and last-opened workspace session restoration.

use std::fs;
use crate::commands::config::validate_allowed_root;
use super::helpers::{ensure_registry, is_valid_workspace, last_workspace_path};
use super::models::WorkspaceInfo;

const MAX_RECENT_WORKSPACES: usize = 20;

// ────────────────────────────
// Tauri commands — Recent workspaces registry
// ────────────────────────────

/// Retrieves the list of recent workspaces, filtering out any invalid paths
#[tauri::command]
pub fn get_recent_workspaces(app_handle: tauri::AppHandle) -> Result<Vec<WorkspaceInfo>, String> {
    let registry = ensure_registry(&app_handle)?;
    if !registry.exists() {
        return Ok(vec![]);
    }
    let json = fs::read_to_string(&registry).map_err(|e| e.to_string())?;
    let mut workspaces: Vec<WorkspaceInfo> = serde_json::from_str(&json)
        .map_err(|_| "Invalid workspaces registry.".to_string())?;
    
    // Prune entries that no longer exist or are not allowed
    workspaces.retain(|w| is_valid_workspace(&w.path) && validate_allowed_root(&app_handle, &w.path).is_ok());
    
    if !workspaces.is_empty() && !workspaces[0].id.is_empty() {
        let cleaned = serde_json::to_string_pretty(&workspaces).map_err(|e| e.to_string())?;
        fs::write(&registry, cleaned).map_err(|e| e.to_string())?;
    }
    Ok(workspaces)
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

/// Adds or moves a workspace to the top of the recent workspaces registry
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
    workspaces.retain(|w| w.id != workspace.id);
    workspaces.insert(0, workspace);
    workspaces.truncate(MAX_RECENT_WORKSPACES);
    let json = serde_json::to_string_pretty(&workspaces).map_err(|e| e.to_string())?;
    fs::write(&registry, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Removes a workspace by ID from the recent workspaces registry
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
    workspaces.retain(|w| w.id != id);
    let json = serde_json::to_string_pretty(&workspaces).map_err(|e| e.to_string())?;
    fs::write(&registry, json).map_err(|e| e.to_string())?;
    Ok(())
}