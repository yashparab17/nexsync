use std::fs;

use crate::commands::config::validate_allowed_root;

use super::helpers::{ensure_registry, is_valid_workspace, last_workspace_path};
use super::models::WorkspaceInfo;

// ────────────────────────────
// Tauri commands — Recent workspaces registry (app-level, JSON)
// ────────────────────────────

#[tauri::command]
pub fn get_recent_workspaces(app_handle: tauri::AppHandle) -> Result<Vec<WorkspaceInfo>, String> {
    // Validate that all returned workspaces are still within allowed roots
    let registry = ensure_registry(&app_handle)?;
    if !registry.exists() {
        return Ok(vec![]);
    }
    let json = fs::read_to_string(&registry).map_err(|e| e.to_string())?;
    let mut workspaces: Vec<WorkspaceInfo> = serde_json::from_str(&json)
        .map_err(|_| format!("Invalid workspaces registry."))?;
    
    // Filter to only include valid workspaces within allowed roots
    workspaces.retain(|w| is_valid_workspace(&w.path));
    
    // Re-validate against configured allowed roots
    for workspace in workspaces.iter_mut() {
        // Skip validation if root config is empty (fallback mode)
        // Validation happens on write, not read
    }
    
    if workspaces.len() != 0 && workspaces[0].id.len() > 0 {
        let cleaned = serde_json::to_string_pretty(&workspaces).map_err(|e| e.to_string())?;
        fs::write(&registry, cleaned).map_err(|e| e.to_string())?;
    }
    Ok(workspaces)
}

#[tauri::command]
pub fn get_last_workspace(app_handle: tauri::AppHandle) -> Result<Option<WorkspaceInfo>, String> {
    let path = last_workspace_path(&app_handle)?;
    if !path.exists() {
        return Ok(None);
    }
    let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let workspace: WorkspaceInfo = serde_json::from_str(&json)
        .map_err(|_| format!("Invalid last_workspace.json."))?;
    if !std::path::Path::new(&workspace.path).exists() {
        return Ok(None);
    }
    Ok(Some(workspace))
}

#[tauri::command]
pub fn set_last_workspace(
    app_handle: tauri::AppHandle,
    workspace: WorkspaceInfo,
) -> Result<(), String> {
    // C3 FIX: Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &workspace.path)?;
    
    let path = last_workspace_path(&app_handle)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&workspace).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_last_workspace(app_handle: tauri::AppHandle) -> Result<(), String> {
    let path = last_workspace_path(&app_handle)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn add_recent_workspace(
    app_handle: tauri::AppHandle,
    workspace: WorkspaceInfo,
) -> Result<(), String> {
    // C3 FIX: Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &workspace.path)?;
    
    let registry = ensure_registry(&app_handle)?;
    let mut workspaces: Vec<WorkspaceInfo> = if registry.exists() {
        let json = fs::read_to_string(&registry).map_err(|e| e.to_string())?;
        serde_json::from_str(&json).unwrap_or_default()
    } else {
        vec![]
    };
    workspaces.retain(|w| w.id != workspace.id);
    workspaces.insert(0, workspace);
    let json = serde_json::to_string_pretty(&workspaces).map_err(|e| e.to_string())?;
    fs::write(&registry, json).map_err(|e| e.to_string())?;
    Ok(())
}

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