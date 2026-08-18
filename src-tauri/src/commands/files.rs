use std::fs;
use std::path::{Component, Path, PathBuf};
use std::io::Write;

use chrono::Utc;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use super::workspace::{WorkspaceFile, WORKSPACE_SUBDIRS};

fn resolve_workspace_path(
    workspace_path: &str,
    subdir: &str,
    relative_path: &str,
) -> Result<PathBuf, String> {
    if !WORKSPACE_SUBDIRS.contains(&subdir) {
        return Err(format!("Invalid workspace subdirectory: {subdir}"));
    }

    let base = Path::new(workspace_path).join(subdir);
    let rel = Path::new(relative_path);

    if rel.is_absolute() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("Invalid relative path".into());
    }

    let target = base.join(rel);
    if !target.starts_with(&base) {
        return Err("Invalid relative path".into());
    }

    Ok(target)
}

#[tauri::command]
pub fn list_files(
    path: String,
    subdir: String,
    relative_path: String,
) -> Result<Vec<WorkspaceFile>, String> {
    let dir = resolve_workspace_path(&path, &subdir, &relative_path)?;

    if !dir.is_dir() {
        return Err("The target path is not a directory.".into());
    }

    let mut files = vec![];

    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = entry.metadata().map_err(|e| e.to_string())?;

        let modified_at = meta
            .modified()
            .ok()
            .map(|t| {
                let dt: chrono::DateTime<Utc> = t.into();
                dt.to_rfc3339()
            })
            .unwrap_or_default();

        let display_path = if relative_path.is_empty() {
            format!("/{subdir}/{name}")
        } else {
            format!("/{subdir}/{}/{}", relative_path.trim_end_matches('/'), name)
        };

        files.push(WorkspaceFile {
            name,
            path: display_path,
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified_at,
        });
    }

    files.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));

    Ok(files)
}

#[tauri::command]
pub fn read_workspace_file(
    path: String,
    subdir: String,
    relative_path: String,
) -> Result<Vec<u8>, String> {
    let file = resolve_workspace_path(&path, &subdir, &relative_path)?;

    if !file.is_file() {
        return Err("The target is not a file.".into());
    }

    fs::read(&file).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_workspace_file(
    path: String,
    subdir: String,
    relative_path: String,
    contents: Vec<u8>,
) -> Result<(), String> {
    let file = resolve_workspace_path(&path, &subdir, &relative_path)?;

    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(&file, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_workspace_folder(
    path: String,
    subdir: String,
    relative_path: String,
) -> Result<(), String> {
    let dir = resolve_workspace_path(&path, &subdir, &relative_path)?;

    fs::create_dir_all(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_workspace_entry(
    path: String,
    subdir: String,
    relative_path: String,
) -> Result<(), String> {
    let target = resolve_workspace_path(&path, &subdir, &relative_path)?;

    if !target.exists() {
        return Err("The target does not exist.".into());
    }

    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn rename_workspace_entry(
    path: String,
    subdir: String,
    old_relative_path: String,
    new_relative_path: String,
) -> Result<(), String> {
    let old = resolve_workspace_path(&path, &subdir, &old_relative_path)?;
    let new = resolve_workspace_path(&path, &subdir, &new_relative_path)?;

    if let Some(parent) = new.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::rename(&old, &new).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_files_into_workspace(
    app: tauri::AppHandle,
    path: String,
    subdir: String,
    relative_path: String,
) -> Result<Vec<String>, String> {
    let target_dir = resolve_workspace_path(&path, &subdir, &relative_path)?;
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

    let picked = app
        .dialog()
        .file()
        .add_filter("All files", &["*"])
        .blocking_pick_files();

    let Some(files) = picked else {
        return Ok(vec![]);
    };

    let mut saved_names = vec![];

    for file in files {
        let path_buf = file.as_path();
        let Some(name) = path_buf.file_name().map(|n| n.to_string_lossy().to_string()) else {
            continue;
        };

        let dest = target_dir.join(&name);
        fs::copy(&path_buf, &dest).map_err(|e| e.to_string())?;
        saved_names.push(name);
    }

    Ok(saved_names)
}

#[tauri::command]
pub fn export_workspace_file(
    app: tauri::AppHandle,
    path: String,
    subdir: String,
    relative_path: String,
) -> Result<(), String> {
    let source = resolve_workspace_path(&path, &subdir, &relative_path)?;

    if !source.is_file() {
        return Err("The target is not a file.".into());
    }

    let Some(name) = source.file_name().map(|n| n.to_string_lossy().to_string()) else {
        return Err("Could not determine file name.".into());
    };

    let dest = app
        .dialog()
        .file()
        .set_file_name(&name)
        .blocking_save_file();

    let Some(dest_path) = dest else {
        return Ok(());
    };

    fs::copy(&source, dest_path.as_path()).map_err(|e| e.to_string())?;

    Ok(())
}
