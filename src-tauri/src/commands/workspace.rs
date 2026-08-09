use std::fs;
use std::path::Path;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use uuid::Uuid;

// ────────────────────────────
// Core data structures
// ────────────────────────────

/// Top-level workspace identity. The `path` field is the absolute directory
/// on disk where the workspace lives — it is essential for every subsequent
/// read/write operation the frontend performs.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub created_at: String,
    pub updated_at: String,
}

/// All metadata files that live inside `<workspace>/.nexsync/`.
/// This struct is the single payload the frontend receives on workspace
/// load and sends back on save.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct WorkspaceMetadata {
    pub workspace: WorkspaceInfo,
    pub settings: Settings,
    pub members: Members,
    pub activity: Activity,
    pub permissions: Permissions,
    pub history: History,
}

// ────────────────────────────
// Individual metadata structs
// ────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Settings {
    pub theme: String,
    pub autosave: bool,
    pub sync: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Member {
    pub id: String,
    pub name: String,
    pub role: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Members {
    pub members: Vec<Member>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Activity {
    pub events: Vec<ActivityEvent>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ActivityEvent {
    pub id: String,
    pub timestamp: String,
    pub action: String,
    pub detail: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Permissions {
    pub owner: Vec<String>,
    pub editor: Vec<String>,
    pub viewer: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct History {
    pub last_opened: String,
    pub recent_files: Vec<String>,
}

// ────────────────────────────
// Request structs
// ────────────────────────────

#[derive(Deserialize)]
pub struct CreateWorkspaceRequest {
    pub name: String,
    pub description: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UpdateMetadataRequest {
    pub path: String,
    pub metadata: WorkspaceMetadata,
}

// ────────────────────────────
// Helpers
// ────────────────────────────

/// Writes `value` as pretty JSON to `<workspace_path>/.nexsync/<name>.json`.
fn write_metadata_json<T: Serialize>(
    workspace_path: &Path,
    name: &str,
    value: &T,
) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;

    fs::write(
        workspace_path.join(".nexsync").join(format!("{name}.json")),
        json,
    )
    .map_err(|e| e.to_string())
}

/// Reads and deserialises `<workspace_path>/.nexsync/<name>.json`.
/// Returns `None` if the file does not exist, or an error if it is
/// present but corrupted.
fn read_metadata_json<T: for<'de> Deserialize<'de>>(
    workspace_path: &Path,
    name: &str,
) -> Result<Option<T>, String> {
    let file_path = workspace_path.join(".nexsync").join(format!("{name}.json"));

    if !file_path.exists() {
        return Ok(None);
    }

    let json = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read {name}.json: {e}"))?;

    let value: T = serde_json::from_str(&json)
        .map_err(|e| format!("Invalid {name}.json: {e}"))?;

    Ok(Some(value))
}

/// Returns the path to the workspace registry file in the app-data directory.
fn registry_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    Ok(app_data.join("nexsync").join("workspaces.json"))
}

/// Ensures the registry directory exists and returns the registry path.
fn ensure_registry(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let path = registry_path(app_handle)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    Ok(path)
}

// ────────────────────────────
// Tauri commands
// ────────────────────────────

/// Creates a new workspace on disk with all default metadata files.
#[tauri::command]
pub fn create_workspace(request: CreateWorkspaceRequest) -> Result<WorkspaceInfo, String> {
    let workspace_path = Path::new(&request.path).join(&request.name);
    let workspace_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    fs::create_dir_all(&workspace_path).map_err(|e| e.to_string())?;
    fs::create_dir_all(workspace_path.join(".nexsync")).map_err(|e| e.to_string())?;

    let workspace = WorkspaceInfo {
        id: workspace_id,
        name: request.name,
        description: request.description,
        path: workspace_path.to_string_lossy().to_string(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    let settings = Settings {
        theme: "dark".to_string(),
        autosave: true,
        sync: true,
    };

    let members = Members {
        members: vec![Member {
            id: "owner".to_string(),
            name: "User".to_string(),
            role: "Owner".to_string(),
        }],
    };

    let activity = Activity { events: vec![] };

    let permissions = Permissions {
        owner: vec!["create".into(), "delete".into(), "invite".into(), "edit".into()],
        editor: vec!["edit".into(), "create".into()],
        viewer: vec!["view".into()],
    };

    let history = History {
        last_opened: now,
        recent_files: vec![],
    };

    write_metadata_json(&workspace_path, "workspace", &workspace)?;
    write_metadata_json(&workspace_path, "settings", &settings)?;
    write_metadata_json(&workspace_path, "members", &members)?;
    write_metadata_json(&workspace_path, "activity", &activity)?;
    write_metadata_json(&workspace_path, "permissions", &permissions)?;
    write_metadata_json(&workspace_path, "history", &history)?;

    let folders = ["notes", "files", "tasks", "kanban", "editor", "assets"];

    for folder in folders {
        fs::create_dir_all(workspace_path.join(folder)).map_err(|e| e.to_string())?;
    }

    Ok(workspace)
}

/// Imports a workspace by reading its `workspace.json` metadata file.
/// Returns the `WorkspaceInfo` (including the absolute path).
#[tauri::command]
pub fn import_workspace(path: String) -> Result<WorkspaceInfo, String> {
    let workspace_path = Path::new(&path);

    if !workspace_path.exists() {
        return Err("The selected folder does not exist.".to_string());
    }

    let metadata_path = workspace_path.join(".nexsync").join("workspace.json");

    if !metadata_path.exists() {
        return Err("This folder is not a valid Nexsync workspace.".to_string());
    }

    let json = fs::read_to_string(&metadata_path)
        .map_err(|e| format!("Failed to read workspace metadata: {e}"))?;

    let mut workspace: WorkspaceInfo =
        serde_json::from_str(&json).map_err(|e| format!("Invalid workspace.json: {e}"))?;

    // Ensure the path is always set, even if the stored JSON predates this field.
    workspace.path = path;

    Ok(workspace)
}

/// Reads **all** metadata files for a workspace and returns them as a single
/// `WorkspaceMetadata` struct. Missing files are filled with defaults so the
/// frontend always receives a complete object.
#[tauri::command]
pub fn read_workspace_metadata(path: String) -> Result<WorkspaceMetadata, String> {
    let workspace_path = Path::new(&path);

    if !workspace_path.exists() {
        return Err("The workspace path does not exist.".to_string());
    }

    let workspace: WorkspaceInfo = read_metadata_json(workspace_path, "workspace")?
        .ok_or("workspace.json is missing.")?;

    let settings: Settings = read_metadata_json(workspace_path, "settings")?
        .unwrap_or_default();

    let members: Members = read_metadata_json(workspace_path, "members")?
        .unwrap_or_default();

    let activity: Activity = read_metadata_json(workspace_path, "activity")?
        .unwrap_or_default();

    let permissions: Permissions = read_metadata_json(workspace_path, "permissions")?
        .unwrap_or_default();

    let history: History = read_metadata_json(workspace_path, "history")?
        .unwrap_or_default();

    Ok(WorkspaceMetadata {
        workspace,
        settings,
        members,
        activity,
        permissions,
        history,
    })
}

/// Writes **all** metadata files for a workspace from a single
/// `WorkspaceMetadata` struct.
#[tauri::command]
pub fn write_workspace_metadata(request: UpdateMetadataRequest) -> Result<(), String> {
    let workspace_path = Path::new(&request.path);

    fs::create_dir_all(workspace_path.join(".nexsync")).map_err(|e| e.to_string())?;

    write_metadata_json(workspace_path, "workspace", &request.metadata.workspace)?;
    write_metadata_json(workspace_path, "settings", &request.metadata.settings)?;
    write_metadata_json(workspace_path, "members", &request.metadata.members)?;
    write_metadata_json(workspace_path, "activity", &request.metadata.activity)?;
    write_metadata_json(workspace_path, "permissions", &request.metadata.permissions)?;
    write_metadata_json(workspace_path, "history", &request.metadata.history)?;

    Ok(())
}

/// Returns the list of recently opened workspaces from the app-level registry.
#[tauri::command]
pub fn get_recent_workspaces(app_handle: tauri::AppHandle) -> Result<Vec<WorkspaceInfo>, String> {
    let registry = ensure_registry(&app_handle)?;

    if !registry.exists() {
        return Ok(vec![]);
    }

    let json = fs::read_to_string(&registry).map_err(|e| e.to_string())?;

    let workspaces: Vec<WorkspaceInfo> =
        serde_json::from_str(&json).map_err(|e| format!("Invalid workspaces registry: {e}"))?;

    Ok(workspaces)
}

/// Adds or updates a workspace in the recent-workspaces registry.
#[tauri::command]
pub fn add_recent_workspace(
    app_handle: tauri::AppHandle,
    workspace: WorkspaceInfo,
) -> Result<(), String> {
    let registry = ensure_registry(&app_handle)?;

    let mut workspaces: Vec<WorkspaceInfo> = if registry.exists() {
        let json = fs::read_to_string(&registry).map_err(|e| e.to_string())?;
        serde_json::from_str(&json).unwrap_or_default()
    } else {
        vec![]
    };

    // Remove any existing entry with the same id, then prepend the new one.
    workspaces.retain(|w| w.id != workspace.id);
    workspaces.insert(0, workspace);

    let json = serde_json::to_string_pretty(&workspaces).map_err(|e| e.to_string())?;
    fs::write(&registry, json).map_err(|e| e.to_string())?;

    Ok(())
}

/// Removes a workspace from the recent-workspaces registry by id.
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
