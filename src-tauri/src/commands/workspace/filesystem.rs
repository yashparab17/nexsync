use std::fs;
use chrono::{DateTime, Utc};
use base64::prelude::*;
use crate::commands::config::validate_allowed_root;
use super::helpers::{validate_workspace_item_name, validate_workspace_rel_path_with_roots};
use super::models::WorkspaceFile;

/// Maximum file size for text file write and read operations (10 MB)
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// Maximum binary asset file size for preview/upload operations (50 MB)
const MAX_BINARY_FILE_SIZE: u64 = 50 * 1024 * 1024;

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
    let clean_sub = subdir.trim().trim_matches('/');
    if !clean_sub.is_empty() && clean_sub != "." {
        validate_workspace_rel_path_with_roots(clean_sub, &["notes", "files", "assets", "tasks", "kanban", "editor"])?;
    }
    
    let target_sub = if clean_sub.is_empty() { "." } else { clean_sub };
    let dir = crate::commands::path_utils::resolve_workspace_path(&path, target_sub)?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(&dir).map_err(|_| "Failed to list directory.".to_string())?;
    let mut files = vec![];

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        
        // Hide internal .nexsync directory and hidden files
        if file_name.starts_with('.') {
            continue;
        }

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
            
        let item_path = if clean_sub.is_empty() || clean_sub == "." {
            format!("/{}", file_name)
        } else {
            format!("/{}/{}", clean_sub, file_name)
        };

        files.push(WorkspaceFile {
            name: file_name.clone(),
            path: item_path,
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

/// Reads a workspace binary file and returns its base64-encoded string
#[tauri::command]
pub fn read_workspace_binary_file(
    app_handle: tauri::AppHandle,
    path: String,
    rel_path: String,
) -> Result<String, String> {
    validate_allowed_root(&app_handle, &path)?;
    validate_workspace_rel_path_with_roots(&rel_path, &["notes", "files", "assets", "tasks", "kanban", "editor"])?;

    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    if !target.exists() || target.is_dir() {
        return Err(format!("File not found: /{rel_path}"));
    }

    let file_len = target.metadata().map(|m| m.len()).unwrap_or(0);
    if file_len > MAX_BINARY_FILE_SIZE {
        return Err(format!(
            "File size exceeds maximum allowed size ({} MB).",
            MAX_BINARY_FILE_SIZE / (1024 * 1024)
        ));
    }

    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    Ok(BASE64_STANDARD.encode(&bytes))
}

/// Writes binary base64 data to a workspace file
#[tauri::command]
pub fn write_workspace_binary_file(
    app_handle: tauri::AppHandle,
    path: String,
    rel_path: String,
    base64_data: String,
) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    validate_workspace_rel_path_with_roots(&rel_path, &["notes", "files", "assets", "tasks", "kanban", "editor"])?;

    let bytes = BASE64_STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Invalid base64 payload: {}", e))?;

    if bytes.len() as u64 > MAX_BINARY_FILE_SIZE {
        return Err(format!(
            "Payload exceeds maximum allowed size ({} MB).",
            MAX_BINARY_FILE_SIZE / (1024 * 1024)
        ));
    }

    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(&target, bytes).map_err(|e| e.to_string())
}

/// Imports an external file from disk into the workspace assets/ folder
#[tauri::command]
pub fn import_asset_from_path(
    app_handle: tauri::AppHandle,
    workspace_path: String,
    source_path: String,
) -> Result<WorkspaceFile, String> {
    validate_allowed_root(&app_handle, &workspace_path)?;

    let src = std::path::Path::new(&source_path);
    if !src.exists() || !src.is_file() {
        return Err("Source file does not exist or is not a file.".to_string());
    }

    let src_len = src.metadata().map(|m| m.len()).unwrap_or(0);
    if src_len > MAX_BINARY_FILE_SIZE {
        return Err(format!(
            "File size ({} MB) exceeds maximum allowed upload size ({} MB).",
            src_len / (1024 * 1024),
            MAX_BINARY_FILE_SIZE / (1024 * 1024)
        ));
    }

    let file_stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("asset");
    let extension = src
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();

    let assets_dir = crate::commands::path_utils::resolve_workspace_path(&workspace_path, "assets")?;
    if !assets_dir.exists() {
        fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;
    }

    // Sanitize file stem and avoid collisions
    let sanitized_stem: String = file_stem
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();

    let mut final_name = format!("{}{}", sanitized_stem, extension);
    let mut counter = 1;
    while assets_dir.join(&final_name).exists() {
        final_name = format!("{}_{}{}", sanitized_stem, counter, extension);
        counter += 1;
    }

    let dest = assets_dir.join(&final_name);
    fs::copy(src, &dest).map_err(|e| format!("Failed to copy file: {}", e))?;

    let metadata = dest.metadata().map_err(|e| e.to_string())?;
    let modified_at = metadata
        .modified()
        .ok()
        .map(|t| {
            let dt: DateTime<Utc> = t.into();
            dt.to_rfc3339()
        })
        .unwrap_or_default();

    Ok(WorkspaceFile {
        name: final_name.clone(),
        path: format!("/assets/{}", final_name),
        is_dir: false,
        size: metadata.len(),
        modified_at,
    })
}