use std::fs;
use std::path::Path;

use serde::Serialize;

#[derive(Serialize)]
struct WorkspaceInfo {
    name: String,
    description: String,
    id: String,
}

#[derive(Serialize)]
struct Settings {
    theme: String,
    autosave: bool,
    sync: bool,
}

#[derive(Serialize)]
struct Member {
    id: String,
    name: String,
    role: String,
}

#[derive(Serialize)]
struct Members {
    members: Vec<Member>,
}

#[derive(Serialize)]
struct Activity {
    events: Vec<String>,
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

    let workspace = WorkspaceInfo {
        name,
        description,
        id,
    };

    let settings = Settings {
        theme: "dark".to_string(),
        autosave: true,
        sync: true,
    };

    let members = Members {
        members: vec![
            Member {
                id: "owner".to_string(),
                name: "User".to_string(),
                role: "Owner".to_string(),
            }
        ]
    };

    let activity = Activity {
        events: vec![],
    };

    let workspace_json =
        serde_json::to_string_pretty(&workspace)
            .map_err(|e| e.to_string())?;

    let settings_json =
        serde_json::to_string_pretty(&settings)
            .map_err(|e| e.to_string())?;

    let members_json =
        serde_json::to_string_pretty(&members)
            .map_err(|e| e.to_string())?;

    let activity_json =
        serde_json::to_string_pretty(&activity)
            .map_err(|e| e.to_string())?;

    fs::write(
        workspace_path.join(".nexsync/workspace.json"),
        workspace_json,
    ).map_err(|e| e.to_string())?;

    fs::write(
        workspace_path.join(".nexsync/settings.json"),
        settings_json,
    ).map_err(|e| e.to_string())?;

    fs::write(
        workspace_path.join(".nexsync/members.json"),
        members_json,
    ).map_err(|e| e.to_string())?;

    fs::write(
        workspace_path.join(".nexsync/activity.json"),
        activity_json,
    ).map_err(|e| e.to_string())?;

    let folders = [
        "notes",
        "files",
        "tasks",
        "kanban",
        "editor",
        "attachments",
    ];

    for folder in folders {
        fs::create_dir_all(workspace_path.join(folder))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}