//! Filesystem commands for managing workspace files and folders.

use std::fs;
use chrono::{DateTime, Utc};
use crate::commands::config::validate_allowed_root;
use super::helpers::{validate_workspace_item_name, validate_workspace_rel_path_with_roots};
use super::models::WorkspaceFile;

/// Maximum file size for file write and read operations (10 MB)
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;

// ────────────────────────────
// Tauri commands — Filesystem
// ────────────────────────────

/// Lists files and directories in a workspace content subdirectory
#[tauri::command]
pub fn list_workspace_files(
    app_handle: tauri::AppHandle,
    path: String,
    subdir: String,
) -> Result<Vec<WorkspaceFile>, String> {
    validate_allowed_root(&app_handle, &path)?;
    validate_workspace_rel_path_with_roots(&subdir, &["notes", "files", "assets", "tasks", "kanban", "editor"])?;
    
    let dir = crate::commands::path_utils::resolve_workspace_path(&path, &subdir)?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(&dir).map_err(|_| "Failed to list directory.".to_string())?;
    let mut files = vec![];

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        
        let metadata = entry
            .path()
            .symlink_metadata()
            .map_err(|_| format!("Failed to read metadata for {file_name}."))?;
        
        // Skip unsafe symlinks
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

    // Sort folders first, then alphabetically
    files.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(files)
}

/// Creates a new empty file or folder in a workspace directory
#[tauri::command]
pub fn create_workspace_item(
    app_handle: tauri::AppHandle,
    path: String,
    rel_path: String,
    name: String,
    is_dir: bool,
) -> Result<(), String> {
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
        if target.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_SIZE {
            return Err("File size too large for pre-creation check.".to_string());
        }
        fs::write(&target, "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Reads text contents from a workspace file
#[tauri::command]
pub fn read_workspace_file(app_handle: tauri::AppHandle, path: String, rel_path: String) -> Result<String, String> {
    validate_allowed_root(&app_handle, &path)?;
    validate_workspace_rel_path_with_roots(&rel_path, &["notes", "files", "assets", "tasks", "kanban", "editor"])?;
    
    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    
    if !target.exists() {
        return Err(format!("File not found: /{rel_path}"));
    }
    if target.is_dir() {
        return Err(format!("Path is a directory, not a file: /{rel_path}"));
    }

    let file_len = target.metadata().map(|m| m.len()).unwrap_or(0);
    if file_len > MAX_FILE_SIZE {
        return Err(format!("File too large to read ({} bytes), maximum is {} bytes.", file_len, MAX_FILE_SIZE));
    }

    fs::read_to_string(&target).map_err(|e| e.to_string())
}

/// Writes text contents to a workspace file
#[tauri::command]
pub fn write_workspace_file(app_handle: tauri::AppHandle, path: String, rel_path: String, content: String) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    validate_workspace_rel_path_with_roots(&rel_path, &["notes", "files", "assets", "tasks", "kanban", "editor"])?;
    
    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    
    if content.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("File too large ({} bytes), maximum is {} bytes.", content.len(), MAX_FILE_SIZE));
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(&target, content.as_bytes()).map_err(|e| e.to_string())
}

/// Renames a workspace file or directory
#[tauri::command]
pub fn rename_workspace_item(
    app_handle: tauri::AppHandle,
    path: String,
    rel_path: String,
    new_name: String,
) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    validate_workspace_rel_path_with_roots(&rel_path, &["notes", "files", "tasks", "kanban", "editor", "assets"])?;
    validate_workspace_item_name(&new_name)?;
    
    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    let parent = target.parent().ok_or("Invalid item path.")?;
    let new_path = parent.join(&new_name);

    let canonical_workspace = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize workspace path: {}", e))?;
    if !parent.starts_with(&canonical_workspace) && parent != canonical_workspace {
        return Err("Path traversal detected: renamed item escapes workspace directory".to_string());
    }

    if !target.exists() {
        return Err(format!("Item not found: /{rel_path}"));
    }
    if new_path.exists() {
        return Err(format!("An item named `{new_name}` already exists here."));
    }
    fs::rename(&target, &new_path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Deletes a file or directory permanently
#[tauri::command]
pub fn delete_workspace_item(app_handle: tauri::AppHandle, path: String, rel_path: String) -> Result<(), String> {
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