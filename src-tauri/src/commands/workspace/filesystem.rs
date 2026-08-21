use std::fs;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::commands::config::validate_allowed_root;

use super::helpers::{validate_workspace_item_name, validate_workspace_rel_path_with_roots};

/// Maximum file size for write_workspace_file (10 MB)
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;

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
pub fn list_workspace_files(
    app_handle: tauri::AppHandle,
    path: String,
    subdir: String,
) -> Result<Vec<WorkspaceFile>, String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &path)?;

    validate_workspace_rel_path_with_roots(&subdir, &["notes", "files", "assets", "tasks", "kanban", "editor"])?;
    let dir = crate::commands::path_utils::resolve_workspace_path(&path, &subdir)?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(&dir).map_err(|_| format!("Failed to list directory."))?;
    let mut files = vec![];

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        
        // L5 FIX: Use symlink_metadata to avoid unknowingly following arbitrary external symlinks
        let metadata = entry
            .path()
            .symlink_metadata()
            .map_err(|_| format!("Failed to read metadata for {file_name}."))?;
        
        // Skip symlinks that point outside or could be unsafe
        if metadata.is_symlink() {
            continue;
        }

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

    validate_workspace_rel_path_with_roots(&rel_path, &["notes", "files", "tasks", "kanban", "editor", "assets"])?;
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
        if target.metadata().map(|m| m.len() as u64).unwrap_or(0) > MAX_FILE_SIZE {
            return Err(format!(
                "File size too large for pre-creation check."
            ));
        }
        fs::write(&target, "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_workspace_file(app_handle: tauri::AppHandle, path: String, rel_path: String) -> Result<String, String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &path)?;

    validate_workspace_rel_path_with_roots(&rel_path, &["notes", "files", "assets", "tasks", "kanban", "editor"])?;
    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    
    if !target.exists() {
        return Err(format!("File not found: /{rel_path}"));
    }
    if target.is_dir() {
        return Err(format!("Path is a directory, not a file: /{rel_path}"));
    }

    // L7 FIX: Guard against reading excessively large files into memory
    let file_len = target.metadata().map(|m| m.len()).unwrap_or(0);
    if file_len > MAX_FILE_SIZE {
        return Err(format!("File too large to read ({} bytes), maximum is {} bytes.", file_len, MAX_FILE_SIZE));
    }

    fs::read_to_string(&target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_workspace_file(app_handle: tauri::AppHandle, path: String, rel_path: String, content: String) -> Result<(), String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &path)?;

    validate_workspace_rel_path_with_roots(&rel_path, &["notes", "files", "assets", "tasks", "kanban", "editor"])?;
    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    
    if content.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("File too large ({} bytes), maximum is {} bytes.", content.len(), MAX_FILE_SIZE));
    }

    // Ensure parent directory exists
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(&target, content.as_bytes()).map_err(|e| e.to_string())
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

    validate_workspace_rel_path_with_roots(&rel_path, &["notes", "files", "tasks", "kanban", "editor", "assets"])?;
    validate_workspace_item_name(&new_name)?;
    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    let parent = target.parent().ok_or("Invalid item path.")?;
    let new_path = parent.join(&new_name);

    // H1 FIX: Validate that the new path still stays within the workspace
    validate_allowed_root(&app_handle, new_path.to_string_lossy().as_ref())?;

    if !target.exists() {
        return Err(format!("Item not found: /{rel_path}"));
    }
    if new_path.exists() {
        return Err(format!("An item named `{new_name}` already exists here."));
    }
    fs::rename(&target, &new_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_workspace_item(app_handle: tauri::AppHandle, path: String, rel_path: String) -> Result<(), String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &path)?;

    validate_workspace_rel_path_with_roots(&rel_path, &["notes", "files", "tasks", "kanban", "editor", "assets"])?;
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