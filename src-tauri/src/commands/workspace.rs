use std::fs;
use std::path::Path;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use uuid::Uuid;

pub(crate) const WORKSPACE_SUBDIRS: &[&str] = &[
    "notes", "files", "assets", "tasks", "kanban", "editor",
];

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
    /// Optional workspace-relative path for deep-linking (e.g. `/files/notes/a.md`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// Optional entity type for the target (e.g. `file`, `task`, `note`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_type: Option<String>,
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
// Dashboard / filesystem structs
// ────────────────────────────

/// A single entry (file or folder) inside a workspace subdirectory.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkspaceFile {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: String,
}

/// Aggregate statistics for the Dashboard stat cards.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct WorkspaceStats {
    pub files: usize,
    pub assets: usize,
    pub tasks: usize,
    pub kanban_cards: usize,
    pub members: usize,
}

// ────────────────────────────
// Error logging
// ────────────────────────────

/// A single entry in the app-level error log (`errors.jsonl`).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ErrorRecord {
    pub timestamp: String,
    pub message: String,
    pub source: String,
    // Workspace path if the error is tied to one (optional for future use).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Returns the path to the app-level error log in the app-data directory.
fn error_log_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    Ok(app_data.join("nexsync").join("errors.jsonl"))
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
/// The write is atomic: it first writes to a temporary file and then renames it.
fn write_metadata_json<T: Serialize>(
    workspace_path: &Path,
    name: &str,
    value: &T,
) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;

    let file_path = workspace_path.join(".nexsync").join(format!("{name}.json"));
    let tmp_path = file_path.with_extension("json.tmp");

    fs::write(&tmp_path, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &file_path).map_err(|e| e.to_string())?;

    Ok(())
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

/// Validates a metadata file name to prevent path traversal. Only allows
/// alphanumeric characters, dashes, and underscores — no separators or dots.
fn validate_metadata_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 64
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("Invalid metadata file name: {name}"));
    }
    Ok(())
}

/// Returns the path to the workspace registry file in the app-data directory.
fn registry_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    Ok(app_data.join("nexsync").join("workspaces.json"))
}

/// Returns the path to the last-workspace file in the app-data directory.
/// This is separate from the registry — it tracks only the single most
/// recently opened workspace for session restoration.
fn last_workspace_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    Ok(app_data.join("nexsync").join("last_workspace.json"))
}

/// Ensures the registry directory exists and returns the registry path.
fn ensure_registry(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let path = registry_path(app_handle)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    Ok(path)
}

/// Validates that `subdir` is one of the known workspace content folders.
/// This prevents path traversal (no separators, dots, or absolute paths).
fn validate_subdir(subdir: &str) -> Result<(), String> {
    if WORKSPACE_SUBDIRS.contains(&subdir) {
        Ok(())
    } else {
        Err(format!("Invalid workspace subdirectory: {subdir}"))
    }
}

/// Returns `true` if `path` points to a valid Nexsync workspace directory —
/// i.e. the folder exists and contains its `.nexsync/workspace.json` metadata
/// file. Used to prune stale entries from the recent-workspaces registry.
fn is_valid_workspace(path: &str) -> bool {
    let dir = Path::new(path);
    dir.is_dir() && dir.join(".nexsync").join("workspace.json").exists()
}

// ────────────────────────────
// Tauri commands
// ────────────────────────────

/// Appends a single error record to the app-level error log.
/// The log is JSONL — one compact JSON object per line — so writes are
/// cheap appends and the file stays human-readable.
#[tauri::command]
pub fn log_error(app_handle: tauri::AppHandle, entry: ErrorRecord) -> Result<(), String> {
    let path = error_log_path(&app_handle)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    line.push('\n');

    // Append-only — use OpenOptions so we never clobber existing entries.
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(line.as_bytes())
        .map_err(|e| e.to_string())?;

    Ok(())
}

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

    let folders = WORKSPACE_SUBDIRS;

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

/// Reads a single feature-scoped JSON file from `<workspace>/.nexsync/<name>.json`.
/// Returns `null` if the file does not exist. The `name` is validated to
/// prevent path traversal. This lets individual features (tasks, kanban,
/// files, etc.) persist their own state without rewriting the whole metadata
/// blob.
#[tauri::command]
pub fn read_workspace_json(path: String, name: String) -> Result<Option<serde_json::Value>, String> {
    validate_metadata_name(&name)?;

    let workspace_path = Path::new(&path);

    if !workspace_path.exists() {
        return Err("The workspace path does not exist.".to_string());
    }

    read_metadata_json(workspace_path, &name)
}

/// Writes a single feature-scoped JSON file to `<workspace>/.nexsync/<name>.json`.
/// The `name` is validated to prevent path traversal.
#[tauri::command]
pub fn write_workspace_json(
    path: String,
    name: String,
    data: serde_json::Value,
) -> Result<(), String> {
    validate_metadata_name(&name)?;

    let workspace_path = Path::new(&path);

    fs::create_dir_all(workspace_path.join(".nexsync")).map_err(|e| e.to_string())?;

    write_metadata_json(workspace_path, &name, &data)
}

/// Lists files and folders inside a workspace content subdirectory
/// (e.g. `notes`, `files`, `assets`, `tasks`, `kanban`). Returns them as
/// flat, non-recursive entries for the current level. The `subdir` is
/// validated to prevent path traversal.
#[tauri::command]
pub fn list_workspace_files(path: String, subdir: String) -> Result<Vec<WorkspaceFile>, String> {
    validate_subdir(&subdir)?;

    let dir = Path::new(&path).join(&subdir);

    if !dir.exists() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to list {subdir}: {e}"))?;

    let mut files = vec![];

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata for {file_name}: {e}"))?;

        let modified_at = metadata
            .modified()
            .ok()
            .map(|t| {
                let dt: chrono::DateTime<Utc> = t.into();
                dt.to_rfc3339()
            })
            .unwrap_or_default();

        files.push(WorkspaceFile {
            name: file_name.clone(),
            path: format!("/{subdir}/{file_name}"),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified_at,
        });
    }

    // Folders first, then files — each sorted alphabetically.
    files.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));

    Ok(files)
}

/// Computes aggregate statistics for the Dashboard. Counts files/assets by
/// scanning the workspace content folders, and reads task/kanban/member
/// counts from the feature-scoped metadata files when present.
#[tauri::command]
pub fn get_workspace_stats(path: String) -> Result<WorkspaceStats, String> {
    let workspace_path = Path::new(&path);

    if !workspace_path.exists() {
        return Err("The workspace path does not exist.".to_string());
    }

    let count_entries = |subdir: &str| -> usize {
        let dir = workspace_path.join(subdir);
        match fs::read_dir(&dir) {
            Ok(entries) => entries.filter_map(Result::ok).filter(|e| e.path().is_file()).count(),
            Err(_) => 0,
        }
    };

    // Task / kanban card counts from feature-scoped JSON.
    let tasks_json: Option<serde_json::Value> =
        read_metadata_json(workspace_path, "tasks").ok().flatten();
    let task_count = tasks_json
        .as_ref()
        .and_then(|v| v.get("tasks"))
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);

    let kanban_json: Option<serde_json::Value> =
        read_metadata_json(workspace_path, "kanban").ok().flatten();
    let kanban_count = kanban_json
        .as_ref()
        .and_then(|v| v.get("columns"))
        .and_then(|v| v.as_array())
        .map(|cols| {
            cols.iter()
                .filter_map(|c| c.get("cards"))
                .filter_map(|c| c.as_array())
                .map(|a| a.len())
                .sum()
        })
        .unwrap_or(0);

    let members_json: Option<Members> =
        read_metadata_json(workspace_path, "members").ok().flatten();
    let member_count = members_json.map(|m| m.members.len()).unwrap_or(0);

    Ok(WorkspaceStats {
        files: count_entries("files") + count_entries("notes") + count_entries("editor"),
        assets: count_entries("assets"),
        tasks: task_count,
        kanban_cards: kanban_count,
        members: member_count,
    })
}

/// Returns the list of recently opened workspaces from the app-level registry.
///
/// Stale entries whose directory no longer exists (or is no longer a valid
/// Nexsync workspace) are pruned, and the cleaned list is persisted back to
/// the registry so it self-heals on every load.
#[tauri::command]
pub fn get_recent_workspaces(app_handle: tauri::AppHandle) -> Result<Vec<WorkspaceInfo>, String> {
    let registry = ensure_registry(&app_handle)?;

    if !registry.exists() {
        return Ok(vec![]);
    }

    let json = fs::read_to_string(&registry).map_err(|e| e.to_string())?;

    let mut workspaces: Vec<WorkspaceInfo> =
        serde_json::from_str(&json).map_err(|e| format!("Invalid workspaces registry: {e}"))?;

    // Prune entries pointing to deleted/invalid workspace directories.
    let before = workspaces.len();
    workspaces.retain(|w| is_valid_workspace(&w.path));

    // Persist the cleaned list only if something was removed.
    if workspaces.len() != before {
        let cleaned = serde_json::to_string_pretty(&workspaces).map_err(|e| e.to_string())?;
        fs::write(&registry, cleaned).map_err(|e| e.to_string())?;
    }

    Ok(workspaces)
}

/// Returns the most recently opened workspace from `last_workspace.json`.
/// Returns `None` if the file doesn't exist or the workspace path is invalid.
#[tauri::command]
pub fn get_last_workspace(app_handle: tauri::AppHandle) -> Result<Option<WorkspaceInfo>, String> {
    let path = last_workspace_path(&app_handle)?;

    if !path.exists() {
        return Ok(None);
    }

    let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;

    let workspace: WorkspaceInfo =
        serde_json::from_str(&json).map_err(|e| format!("Invalid last_workspace.json: {e}"))?;

    // Verify the workspace directory still exists.
    if !Path::new(&workspace.path).exists() {
        return Ok(None);
    }

    Ok(Some(workspace))
}

/// Sets the most recently opened workspace in `last_workspace.json`.
#[tauri::command]
pub fn set_last_workspace(
    app_handle: tauri::AppHandle,
    workspace: WorkspaceInfo,
) -> Result<(), String> {
    let path = last_workspace_path(&app_handle)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let json = serde_json::to_string_pretty(&workspace).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;

    Ok(())
}

/// Clears the last-workspace file so the app opens to the Welcome page.
#[tauri::command]
pub fn clear_last_workspace(app_handle: tauri::AppHandle) -> Result<(), String> {
    let path = last_workspace_path(&app_handle)?;

    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    Ok(())
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
