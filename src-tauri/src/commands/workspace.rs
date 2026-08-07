use std::fs;
use std::path::Path;

use chrono::Utc;
use serde::Serialize;
use uuid::Uuid;

#[derive(Serialize, serde::Deserialize)]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
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

#[derive(Serialize)]
struct Permissions {
    owner: Vec<String>,
    editor: Vec<String>,
    viewer: Vec<String>,
}

#[derive(Serialize)]
struct History {
    last_opened: String,
    recent_files: Vec<String>,
}

#[tauri::command]
pub fn create_workspace(
    name: String,
    description: String,
    path: String,
) -> Result<(), String> {

    let workspace_path = Path::new(&path).join(&name);
    let workspace_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    fs::create_dir_all(&workspace_path)
        .map_err(|e| e.to_string())?;

    fs::create_dir_all(workspace_path.join(".nexsync"))
        .map_err(|e| e.to_string())?;

    let workspace = WorkspaceInfo {
        id: workspace_id,
        name,
        description,
        created_at: now.clone(),
        updated_at: now.clone(),
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

    let permissions = Permissions {
        owner: vec![
            "create".into(),
            "delete".into(),
            "invite".into(),
            "edit".into(),
        ],
        editor: vec![
            "edit".into(),
            "create".into(),
        ],
        viewer: vec![
            "view".into(),
        ],
    };

    let history = History {
        last_opened: now.clone(),
        recent_files: vec![],
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
    
    let permissions_json =
        serde_json::to_string_pretty(&permissions)
            .map_err(|e| e.to_string())?;

    let history_json =
        serde_json::to_string_pretty(&history)
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

    fs::write(
        workspace_path.join(".nexsync/permissions.json"),
        permissions_json,
    ).map_err(|e| e.to_string())?;

    fs::write(
        workspace_path.join(".nexsync/history.json"),
        history_json,
    ).map_err(|e| e.to_string())?;

    let folders = [
        "notes",
        "files",
        "tasks",
        "kanban",
        "editor",
        "assets",
    ];

    for folder in folders {
        fs::create_dir_all(workspace_path.join(folder))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
#[tauri::command]
pub fn import_workspace(path: String) -> Result<WorkspaceInfo, String> {
	let workspace_path = Path::new(&path);

	let metadata_path = workspace_path
		.join(".nexsync")
		.join("workspace.json");

	if !workspace_path.exists() {
		return Err("The selected folder does not exist.".to_string());
	}

	if !metadata_path.exists() {
		return Err(
			"This folder is not a valid Nexsync workspace.".to_string()
		);
	}

	let json = fs::read_to_string(&metadata_path)
		.map_err(|e| format!("Failed to read workspace metadata: {}", e))?;

	let workspace: WorkspaceInfo =
		serde_json::from_str(&json)
			.map_err(|e| format!("Invalid workspace.json: {}", e))?;

	Ok(workspace)
}