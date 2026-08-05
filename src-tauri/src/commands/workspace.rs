use std::fs;
use std::path::Path;

use serde::Serialize;

#[derive(Serialize)]
struct WorkspaceMetadata {
    name: String,
    description: String,
}

#[tauri::command]
pub fn create_workspace(
    name: String,
    description: String,
    path: String,
) -> Result<(), String> {

    let workspace_path = Path::new(&path).join(&name);

    fs::create_dir_all(&workspace_path)
        .map_err(|e| e.to_string())?;

    fs::create_dir_all(workspace_path.join(".nexsync"))
        .map_err(|e| e.to_string())?;

    fs::create_dir_all(workspace_path.join("Notes"))
        .map_err(|e| e.to_string())?;

    fs::create_dir_all(workspace_path.join("Files"))
        .map_err(|e| e.to_string())?;

    fs::create_dir_all(workspace_path.join("Tasks"))
        .map_err(|e| e.to_string())?;

    fs::create_dir_all(workspace_path.join("Kanban"))
        .map_err(|e| e.to_string())?;

    let metadata = WorkspaceMetadata {
        name,
        description,
    };

    let json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| e.to_string())?;

    fs::write(
        workspace_path.join(".nexsync/workspace.json"),
        json,
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}