use std::fs;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::commands::config::validate_allowed_root;

use super::helpers::{validate_workspace_item_name, validate_workspace_rel_path};

/// A single entry (file or folder) inside a workspace subdirectory.
#[derive(Serialize, Clone, Debug)]
pub struct WorkspaceFile {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: String,
}

// ────────────────────────────
// Tauri commands — Filesystem
// ────────────────────────────

#[tauri::command]
pub fn list_workspace_files(app_handle: tauri::AppHandle, path: String, subdir: String) -> Result<Vec<WorkspaceFile>, String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &path)?;
    
    validate_workspace_rel_path(&subdir)?;
    let dir = crate::commands::path_utils::resolve_workspace_path(&path, &subdir)?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(&dir).map_err(|_| format!("Failed to list directory."))?;
    let mut files = vec![];

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        let metadata = entry
            .metadata()
            .map_err(|_| format!("Failed to read metadata for {file_name}."))?;
        let modified_at = metadata
            .modified()
            .ok()
            .map(|t| {
                let dt: DateTime<Utc> = t.into();
                dt.to_rfc3339()
            })
            .unwrap_or_default();
        files.push(WorkspaceFile {
            name: file_name.clone(),
            path: format!("/{}/{}", subdir.trim_matches('/'), file_name),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified_at,
        });
    }

    files.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(files)
}

#[tauri::command]
pub fn create_workspace_item(
    app_handle: tauri::AppHandle,
    path: String,
    rel_path: String,
    name: String,
    is_dir: bool,
) -> Result<(), String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &path)?;
    
    validate_workspace_rel_path(&rel_path)?;
    validate_workspace_item_name(&name)?;
    let base = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    let target = base.join(&name);
    if target.exists() {
        return Err(format!("An item named `{name}` already exists here."));
    }
    if is_dir {
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&target, "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_workspace_file(app_handle: tauri::AppHandle, path: String, rel_path: String) -> Result<String, String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &path)?;
    
    validate_workspace_rel_path(&rel_path)?;
    let file_path = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    if !file_path.is_file() {
        return Err(format!("Not a file: /{rel_path}"));
    }
    fs::read_to_string(&file_path).map_err(|_| format!("Failed to read file."))
}

#[tauri::command]
pub fn write_workspace_file(app_handle: tauri::AppHandle, path: String, rel_path: String, content: String) -> Result<(), String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &path)?;
    
    validate_workspace_rel_path(&rel_path)?;
    let file_path = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&file_path, content).map_err(|_| format!("Failed to write file."))
}

#[tauri::command]
pub fn delete_workspace_item(app_handle: tauri::AppHandle, path: String, rel_path: String) -> Result<(), String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &path)?;
    
    validate_workspace_rel_path(&rel_path)?;
    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    if !target.exists() {
        return Err(format!("Item not found: /{rel_path}"));
    }
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(&target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn rename_workspace_item(
    app_handle: tauri::AppHandle,
    path: String,
    rel_path: String,
    new_name: String,
) -> Result<(), String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &path)?;
    
    validate_workspace_rel_path(&rel_path)?;
    validate_workspace_item_name(&new_name)?;
    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    let parent = target.parent().ok_or("Invalid item path.")?;
    let new_path = parent.join(&new_name);
    if !target.exists() {
        return Err(format!("Item not found: /{rel_path}"));
    }
    if new_path.exists() {
        return Err(format!("An item named `{new_name}` already exists here."));
    }
    fs::rename(&target, &new_path).map_err(|e| e.to_string())?;
    Ok(())
}