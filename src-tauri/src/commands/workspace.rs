use std::fs;
use std::path::Path;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use uuid::Uuid;

use crate::database::WorkspaceDb;

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

/// All metadata that lives in the workspace SQLite database.
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
// Task & Kanban types (feature-scoped structured data)
// ────────────────────────────

/// A single task in the Tasks feature.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Task {
	pub id: String,
	pub title: String,
	pub description: String,
	pub status: String, // "todo" | "in_progress" | "done"
	pub priority: String, // "low" | "medium" | "high"
	#[serde(skip_serializing_if = "Option::is_none")]
	pub due_date: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub assignee_id: Option<String>,
	pub created_at: String,
	pub updated_at: String,
}

/// A single column on the Kanban board.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct KanbanColumn {
	pub id: String,
	pub title: String,
	pub position: i64,
	pub cards: Vec<KanbanCard>,
}

/// A single card inside a Kanban column.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct KanbanCard {
	pub id: String,
	pub title: String,
	pub description: String,
	pub column_id: String,
	pub position: i64,
	pub created_at: String,
	pub updated_at: String,
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

#[derive(Deserialize)]
pub struct TaskRequest {
	pub path: String,
	pub task: Task,
}

#[derive(Deserialize)]
pub struct TaskIdRequest {
	pub path: String,
	pub id: String,
}

#[derive(Deserialize)]
pub struct KanbanColumnRequest {
	pub path: String,
	pub column: KanbanColumn,
}

#[derive(Deserialize)]
pub struct KanbanCardRequest {
	pub path: String,
	pub card: KanbanCard,
}

#[derive(Deserialize)]
pub struct MoveCardRequest {
	pub path: String,
	pub card_id: String,
	pub column_id: String,
	pub position: i64,
}

// ────────────────────────────
// Helpers
// ────────────────────────────

/// Returns the path to the workspace SQLite database file.
fn workspace_db_path(workspace_path: &Path) -> std::path::PathBuf {
	workspace_path.join(".nexsync").join("nexsync.db")
}

/// Returns the workspace id from the SQLite DB.
/// Falls back to `None` if the DB doesn't exist.
fn get_workspace_id(db: &WorkspaceDb) -> Result<String, String> {
	db.conn
		.query_row("SELECT id FROM workspace LIMIT 1", [], |r| r.get(0))
		.map_err(|e| e.to_string())
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

/// Validates a workspace-relative path for safe filesystem access.
/// The first segment must be a known content folder, and each remaining
/// segment must be a valid folder/file name (no traversal, separators,
/// or Windows drive-letter syntax).
fn validate_workspace_rel_path(rel_path: &str) -> Result<(), String> {
	const ALLOWED_ROOTS: &[&str] = &[
		"notes", "files", "assets", "tasks", "kanban", "editor",
	];

	let rel_path = rel_path.trim_matches('/');

	if rel_path.is_empty() {
		return Err("The path cannot be empty.".into());
	}

	let segments: Vec<&str> = rel_path.split('/').collect();

	// The first segment must be a known content root.
	if !ALLOWED_ROOTS.contains(&segments[0]) {
		return Err(format!("Invalid workspace path: {rel_path}"));
	}

	// Every segment (including the root) must be a clean name.
	for segment in &segments {
		if segment.is_empty()
			|| *segment == "."
			|| *segment == ".."
			|| segment.contains('\\')
			|| segment.contains(':')
		{
			return Err(format!("Invalid path segment: {segment}"));
		}
	}

	Ok(())
}

/// Validates a single file/folder name for create/rename operations.
/// Names cannot contain path separators or traversal entries.
fn validate_workspace_item_name(name: &str) -> Result<(), String> {
	if name.is_empty()
		|| name == "."
		|| name == ".."
		|| name.contains('/')
		|| name.contains('\\')
		|| name.contains(':')
	{
		return Err(format!("Invalid item name: {name}"));
	}
	Ok(())
}

/// Returns `true` if `path` points to a valid Nexsync workspace directory —
/// i.e. the folder exists and contains its `.nexsync/nexsync.db` database file.
fn is_valid_workspace(path: &str) -> bool {
	let dir = Path::new(path);

	if !dir.is_dir() {
		return false;
	}

	// Workspaces are validated by the presence of the SQLite database.
	workspace_db_path(dir).exists()
}

// ────────────────────────────
// Tauri commands — Error logging
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

// ────────────────────────────
// Tauri commands — Workspace creation / import
// ────────────────────────────

/// Creates a new workspace on disk with all default metadata in SQLite.
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

	let _activity = Activity { events: vec![] };

	let permissions = Permissions {
		owner: vec!["create".into(), "delete".into(), "invite".into(), "edit".into()],
		editor: vec!["edit".into(), "create".into()],
		viewer: vec!["view".into()],
	};

	let history = History {
		last_opened: now.clone(),
		recent_files: vec![],
	};

	// Open the SQLite database (creates it fresh + runs schema).
	let db = WorkspaceDb::open(&workspace.path)?;

	// Seed all initial data in one transaction.
	let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;

	tx.execute(
		"INSERT INTO workspace (id, name, description, path, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
		rusqlite::params![
			&workspace.id, &workspace.name, &workspace.description,
			&workspace.path, &workspace.created_at, &workspace.updated_at,
		],
	)
	.map_err(|e| e.to_string())?;

	tx.execute(
		"INSERT INTO settings (workspace_id, theme, autosave, sync)
		 VALUES (?1, ?2, ?3, ?4)",
		rusqlite::params![
			&workspace.id, &settings.theme,
			if settings.autosave { 1 } else { 0 },
			if settings.sync { 1 } else { 0 },
		],
	)
	.map_err(|e| e.to_string())?;

	for m in &members.members {
		tx.execute(
			"INSERT INTO members (id, workspace_id, name, role)
			 VALUES (?1, ?2, ?3, ?4)",
			rusqlite::params![&m.id, &workspace.id, &m.name, &m.role],
		)
		.map_err(|e| e.to_string())?;
	}

	// Permissions — normalized rows.
	for p in &permissions.owner {
		tx.execute(
			"INSERT INTO permissions (workspace_id, role, permission) VALUES (?1, ?2, ?3)",
			rusqlite::params![&workspace.id, "owner", p],
		)
		.map_err(|e| e.to_string())?;
	}
	for p in &permissions.editor {
		tx.execute(
			"INSERT INTO permissions (workspace_id, role, permission) VALUES (?1, ?2, ?3)",
			rusqlite::params![&workspace.id, "editor", p],
		)
		.map_err(|e| e.to_string())?;
	}
	for p in &permissions.viewer {
		tx.execute(
			"INSERT INTO permissions (workspace_id, role, permission) VALUES (?1, ?2, ?3)",
			rusqlite::params![&workspace.id, "viewer", p],
		)
		.map_err(|e| e.to_string())?;
	}

	tx.execute(
		"INSERT OR REPLACE INTO history (workspace_id, last_opened, recent_files)
		 VALUES (?1, ?2, ?3)",
		rusqlite::params![&workspace.id, &history.last_opened, "[]"],
	)
	.map_err(|e| e.to_string())?;

	tx.commit().map_err(|e| e.to_string())?;

	// Create the standard content folders.
	let folders = ["notes", "files", "tasks", "kanban", "editor", "assets"];

	for folder in folders {
		fs::create_dir_all(workspace_path.join(folder)).map_err(|e| e.to_string())?;
	}

	Ok(workspace)
}

/// Imports a workspace by reading its SQLite database.
/// Returns the `WorkspaceInfo` (including the absolute path).
#[tauri::command]
pub fn import_workspace(path: String) -> Result<WorkspaceInfo, String> {
	let workspace_path = Path::new(&path);

	if !workspace_path.exists() {
		return Err("The selected folder does not exist.".to_string());
	}

	let db = WorkspaceDb::open(&path)?;

	let workspace: WorkspaceInfo = db
		.conn
		.query_row(
			"SELECT id, name, description, path, created_at, updated_at FROM workspace",
			[],
			|r| {
				Ok(WorkspaceInfo {
					id: r.get(0)?,
					name: r.get(1)?,
				description: r.get(2)?,
				path: r.get(3)?,
				created_at: r.get(4)?,
				updated_at: r.get(5)?,
			})
			},
		)
		.map_err(|e| format!("Failed to read workspace metadata: {e}"))?;

	// Ensure the path is always set to the import path.
	let mut workspace = workspace;
	workspace.path = path;

	Ok(workspace)
}

// ────────────────────────────
// Tauri commands — Workspace metadata read / write
// ────────────────────────────

/// Reads **all** metadata from the workspace SQLite database and returns it
/// as a single `WorkspaceMetadata` struct.
#[tauri::command]
pub fn read_workspace_metadata(path: String) -> Result<WorkspaceMetadata, String> {
	let workspace_path = Path::new(&path);

	if !workspace_path.exists() {
		return Err("The workspace path does not exist.".to_string());
	}

	let db = WorkspaceDb::open(&path)?;

	// Read all metadata in a single transaction.
	let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;

	let workspace: WorkspaceInfo = tx
		.query_row(
			"SELECT id, name, description, path, created_at, updated_at FROM workspace",
			[],
			|r| {
				Ok(WorkspaceInfo {
					id: r.get(0)?,
					name: r.get(1)?,
					description: r.get(2)?,
					path: r.get(3)?,
					created_at: r.get(4)?,
					updated_at: r.get(5)?,
				})
			},
		)
		.map_err(|e| format!("workspace table is empty: {e}"))?;

	let theme: String = tx
		.query_row(
			"SELECT theme FROM settings WHERE workspace_id = ?1",
			[&workspace.id],
			|r| r.get(0),
		)
		.map_err(|e| e.to_string())?;

	let autosave: i64 = tx
		.query_row(
			"SELECT autosave FROM settings WHERE workspace_id = ?1",
			[&workspace.id],
			|r| r.get(0),
		)
		.map_err(|e| e.to_string())?;

	let sync: i64 = tx
		.query_row(
			"SELECT sync FROM settings WHERE workspace_id = ?1",
			[&workspace.id],
			|r| r.get(0),
		)
		.map_err(|e| e.to_string())?;

	let settings = Settings {
		theme,
		autosave: autosave != 0,
		sync: sync != 0,
	};

	let members: Vec<Member> = tx
		.prepare("SELECT id, name, role FROM members WHERE workspace_id = ?1")
		.map_err(|e| e.to_string())?
		.query_map([&workspace.id], |r| {
			Ok(Member {
				id: r.get(0)?,
				name: r.get(1)?,
				role: r.get(2)?,
			})
		})
		.map_err(|e| e.to_string())?
		.filter_map(|r| r.ok())
		.collect();

	let permissions = load_permissions(&tx, &workspace.id)?;
	let history = load_history(&tx, &workspace.id)?;
	let activity = load_activity(&tx, &workspace.id)?;

	tx.commit().map_err(|e| e.to_string())?;

	Ok(WorkspaceMetadata {
		workspace,
		settings,
		members: Members { members },
		activity,
		permissions,
		history,
	})
}

/// Helper: load permissions as normalized rows into the `Permissions` struct.
fn load_permissions(
	tx: &rusqlite::Transaction,
	workspace_id: &str,
) -> Result<Permissions, String> {
	let mut perms = Permissions::default();

	let rows: Vec<(String, String)> = tx
		.prepare(
			"SELECT role, permission FROM permissions WHERE workspace_id = ?1",
		)
		.map_err(|e| e.to_string())?
		.query_map([workspace_id], |r| {
			Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
		})
		.map_err(|e| e.to_string())?
		.filter_map(|r| r.ok())
		.collect();

	for (role, permission) in rows {
		match role.as_str() {
			"owner" => perms.owner.push(permission),
			"editor" => perms.editor.push(permission),
			"viewer" => perms.viewer.push(permission),
			_ => {}
		}
	}

	Ok(perms)
}

/// Helper: load history.
fn load_history(
	tx: &rusqlite::Transaction,
	workspace_id: &str,
) -> Result<History, String> {
	let row: Result<(String, String), rusqlite::Error> = tx.query_row(
		"SELECT last_opened, recent_files FROM history WHERE workspace_id = ?1",
		[workspace_id],
		|r| Ok((r.get(0)?, r.get(1)?)),
	);

	// History row might not exist yet — return defaults.
	let (last_opened, recent_files_json) = row.unwrap_or_else(|_| {
		(chrono::Utc::now().to_rfc3339(), "[]".to_string())
	});

	let recent_files: Vec<String> =
		serde_json::from_str(&recent_files_json).unwrap_or_default();

	Ok(History {
		last_opened,
		recent_files,
	})
}

/// Helper: load activity events.
fn load_activity(
	tx: &rusqlite::Transaction,
	workspace_id: &str,
) -> Result<Activity, String> {
	let mut stmt = tx
		.prepare(
			"SELECT id, timestamp, action, detail, target, target_type
			 FROM activity_events WHERE workspace_id = ?1
			 ORDER BY timestamp DESC",
		)
		.map_err(|e| e.to_string())?;

	let events: Vec<ActivityEvent> = stmt
		.query_map([workspace_id], |r| {
			Ok(ActivityEvent {
				id: r.get(0)?,
				timestamp: r.get(1)?,
				action: r.get(2)?,
				detail: r.get(3)?,
				target: r.get(4).ok(),
				target_type: r.get(5).ok(),
			})
		})
		.map_err(|e| e.to_string())?
		.filter_map(|r| r.ok())
		.collect();

	Ok(Activity { events })
}

/// Writes **all** workspace metadata to the SQLite database from a single
/// `WorkspaceMetadata` struct.
#[tauri::command]
pub fn write_workspace_metadata(request: UpdateMetadataRequest) -> Result<(), String> {
	let db = WorkspaceDb::open(&request.path)?;
	let metadata = &request.metadata;

	let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;

	// Workspace info.
	tx.execute(
		"INSERT OR REPLACE INTO workspace (id, name, description, path, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
		rusqlite::params![
			&metadata.workspace.id,
			&metadata.workspace.name,
			&metadata.workspace.description,
			&metadata.workspace.path,
			&metadata.workspace.created_at,
			&metadata.workspace.updated_at,
		],
	)
	.map_err(|e| e.to_string())?;

	// Settings.
	tx.execute(
		"INSERT OR REPLACE INTO settings (workspace_id, theme, autosave, sync)
		 VALUES (?1, ?2, ?3, ?4)",
		rusqlite::params![
			&metadata.workspace.id,
			&metadata.settings.theme,
			if metadata.settings.autosave { 1 } else { 0 },
			if metadata.settings.sync { 1 } else { 0 },
		],
	)
	.map_err(|e| e.to_string())?;

	// Members — replace all existing rows.
	tx.execute(
		"DELETE FROM members WHERE workspace_id = ?1",
		[&metadata.workspace.id],
	)
	.map_err(|e| e.to_string())?;

	for m in &metadata.members.members {
		tx.execute(
			"INSERT INTO members (id, workspace_id, name, role) VALUES (?1, ?2, ?3, ?4)",
			rusqlite::params![&m.id, &metadata.workspace.id, &m.name, &m.role],
		)
		.map_err(|e| e.to_string())?;
	}

	// Permissions — replace all existing rows.
	tx.execute(
		"DELETE FROM permissions WHERE workspace_id = ?1",
		[&metadata.workspace.id],
	)
	.map_err(|e| e.to_string())?;

	for p in &metadata.permissions.owner {
		tx.execute(
			"INSERT INTO permissions (workspace_id, role, permission) VALUES (?1, ?2, ?3)",
			rusqlite::params![&metadata.workspace.id, "owner", p],
		)
		.map_err(|e| e.to_string())?;
	}
	for p in &metadata.permissions.editor {
		tx.execute(
			"INSERT INTO permissions (workspace_id, role, permission) VALUES (?1, ?2, ?3)",
			rusqlite::params![&metadata.workspace.id, "editor", p],
		)
		.map_err(|e| e.to_string())?;
	}
	for p in &metadata.permissions.viewer {
		tx.execute(
			"INSERT INTO permissions (workspace_id, role, permission) VALUES (?1, ?2, ?3)",
			rusqlite::params![&metadata.workspace.id, "viewer", p],
		)
		.map_err(|e| e.to_string())?;
	}

	// History.
	let recent_files_json =
		serde_json::to_string(&metadata.history.recent_files).unwrap_or_default();
	tx.execute(
		"INSERT OR REPLACE INTO history (workspace_id, last_opened, recent_files)
		 VALUES (?1, ?2, ?3)",
		rusqlite::params![
			&metadata.workspace.id,
			&metadata.history.last_opened,
			recent_files_json,
		],
	)
	.map_err(|e| e.to_string())?;

	// Activity events — replace all.
	tx.execute(
		"DELETE FROM activity_events WHERE workspace_id = ?1",
		[&metadata.workspace.id],
	)
	.map_err(|e| e.to_string())?;

	for e in &metadata.activity.events {
		tx.execute(
			"INSERT INTO activity_events
				(id, workspace_id, timestamp, action, detail, target, target_type)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
			rusqlite::params![
				&e.id,
				&metadata.workspace.id,
				&e.timestamp,
				&e.action,
				&e.detail,
				&e.target,
				&e.target_type,
			],
		)
		.map_err(|e| e.to_string())?;
	}

	tx.commit().map_err(|e| e.to_string())?;

	Ok(())
}

// ────────────────────────────
// Tauri commands — Workspace stats
// ────────────────────────────

/// Computes aggregate statistics for the Dashboard. Counts files/assets by
/// scanning the workspace content folders, and reads task/kanban/member
/// counts from the SQLite database.
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

	let db = WorkspaceDb::open(&path)?;
	let ws_id: String = get_workspace_id(&db)?;

	let task_count: i64 = db
		.conn
		.query_row("SELECT COUNT(*) FROM tasks WHERE workspace_id = ?1", [&ws_id], |r| r.get(0))
		.map_err(|e| e.to_string())?;

	let kanban_count: i64 = db
		.conn
		.query_row(
			"SELECT COUNT(*) FROM kanban_cards WHERE workspace_id = ?1",
			[&ws_id],
			|r| r.get(0),
		)
		.map_err(|e| e.to_string())?;

	let member_count: i64 = db
		.conn
		.query_row(
			"SELECT COUNT(*) FROM members WHERE workspace_id = ?1",
			[&ws_id],
			|r| r.get(0),
		)
		.map_err(|e| e.to_string())?;

	Ok(WorkspaceStats {
		files: count_entries("files") + count_entries("notes") + count_entries("editor"),
		assets: count_entries("assets"),
		tasks: task_count as usize,
		kanban_cards: kanban_count as usize,
		members: member_count as usize,
	})
}

// ────────────────────────────
// Tauri commands — Filesystem (unchanged from JSON era)
// ────────────────────────────

/// Lists files and folders inside a workspace content subdirectory.
/// Supports nested paths (e.g. `files/notes/2024`). Returns flat,
/// non-recursive entries for the current level. The relative path is
/// validated to prevent path traversal.
#[tauri::command]
pub fn list_workspace_files(path: String, subdir: String) -> Result<Vec<WorkspaceFile>, String> {
	validate_workspace_rel_path(&subdir)?;

	let dir = Path::new(&path).join(subdir.trim_matches('/'));

	if !dir.exists() {
		return Ok(vec![]);
	}

	let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to list directory: {e}"))?;

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
			path: format!("/{}/{}", subdir.trim_matches('/'), file_name),
			is_dir: metadata.is_dir(),
			size: metadata.len(),
			modified_at,
		});
	}

	// Folders first, then files — each sorted alphabetically.
	files.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));

	Ok(files)
}

/// Creates a new empty file or folder inside a workspace content directory.
/// `rel_path` is the parent directory (e.g. `files` or `files/notes`),
/// `name` is the new item's name, and `is_dir` selects file vs. folder.
#[tauri::command]
pub fn create_workspace_item(
	path: String,
	rel_path: String,
	name: String,
	is_dir: bool,
) -> Result<(), String> {
	validate_workspace_rel_path(&rel_path)?;
	validate_workspace_item_name(&name)?;

	let base = Path::new(&path).join(rel_path.trim_matches('/'));
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

/// Reads the text contents of a workspace file.
/// `rel_path` must be a workspace-relative path to a file.
/// Binary files (e.g. images) cannot be read as text and return an error.
#[tauri::command]
pub fn read_workspace_file(path: String, rel_path: String) -> Result<String, String> {
	validate_workspace_rel_path(&rel_path)?;

	let file_path = Path::new(&path).join(rel_path.trim_matches('/'));

	if !file_path.is_file() {
		return Err(format!("Not a file: /{rel_path}"));
	}

	fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {e}"))
}

/// Writes text contents to a workspace file, creating parent directories
/// as needed. `rel_path` must be a workspace-relative path to a file.
#[tauri::command]
pub fn write_workspace_file(path: String, rel_path: String, content: String) -> Result<(), String> {
	validate_workspace_rel_path(&rel_path)?;

	let file_path = Path::new(&path).join(rel_path.trim_matches('/'));

	if let Some(parent) = file_path.parent() {
		fs::create_dir_all(parent).map_err(|e| e.to_string())?;
	}

	fs::write(&file_path, content).map_err(|e| format!("Failed to write file: {e}"))
}

/// Permanently deletes a workspace file or folder. Folder deletion is
/// recursive, so the frontend should always confirm before calling this.
/// `rel_path` must point to an existing item.
#[tauri::command]
pub fn delete_workspace_item(path: String, rel_path: String) -> Result<(), String> {
	validate_workspace_rel_path(&rel_path)?;

	let target = Path::new(&path).join(rel_path.trim_matches('/'));

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

/// Renames a workspace file or folder. The new name must be a clean
/// single segment (no separators). `rel_path` is the item's current
/// workspace-relative path.
#[tauri::command]
pub fn rename_workspace_item(
	path: String,
	rel_path: String,
	new_name: String,
) -> Result<(), String> {
	validate_workspace_rel_path(&rel_path)?;
	validate_workspace_item_name(&new_name)?;

	let target = Path::new(&path).join(rel_path.trim_matches('/'));
	let new_path = target
		.parent()
		.ok_or("Invalid item path.")?
		.join(&new_name);

	if !target.exists() {
		return Err(format!("Item not found: /{rel_path}"));
	}

	if new_path.exists() {
		return Err(format!("An item named `{new_name}` already exists here."));
	}

	fs::rename(&target, &new_path).map_err(|e| e.to_string())?;

	Ok(())
}

// ────────────────────────────
// Tauri commands — Recent workspaces registry (app-level, JSON)
// ────────────────────────────

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

// ────────────────────────────
// Tauri commands — Task CRUD
// ────────────────────────────

/// Returns all tasks for a workspace.
#[tauri::command]
pub fn get_tasks(path: String) -> Result<Vec<Task>, String> {
	let db = WorkspaceDb::open(&path)?;
	let ws_id = get_workspace_id(&db)?;

	let tasks: Vec<Task> = db
		.conn
		.prepare(
			"SELECT id, title, description, status, priority, due_date, assignee_id,
			 created_at, updated_at
			 FROM tasks WHERE workspace_id = ?1 ORDER BY created_at DESC",
		)
		.map_err(|e| e.to_string())?
		.query_map([&ws_id], |r| {
			Ok(Task {
				id: r.get(0)?,
				title: r.get(1)?,
				description: r.get(2)?,
				status: r.get(3)?,
				priority: r.get(4)?,
				due_date: r.get(5).ok(),
				assignee_id: r.get(6).ok(),
				created_at: r.get(7)?,
				updated_at: r.get(8)?,
			})
		})
		.map_err(|e| e.to_string())?
		.filter_map(|r| r.ok())
		.collect();

	Ok(tasks)
}

/// Creates a new task in the workspace.
#[tauri::command]
pub fn create_task(request: TaskRequest) -> Result<Task, String> {
	let db = WorkspaceDb::open(&request.path)?;
	let task = request.task;
	let ws_id = get_workspace_id(&db)?;

	db.conn.execute(
		"INSERT INTO tasks (id, workspace_id, title, description, status, priority,
		 due_date, assignee_id, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
		rusqlite::params![
			&task.id, &ws_id, &task.title, &task.description,
			&task.status, &task.priority, &task.due_date,
			&task.assignee_id, &task.created_at, &task.updated_at,
		],
	)
	.map_err(|e| e.to_string())?;

	Ok(task)
}

/// Updates an existing task.
#[tauri::command]
pub fn update_task(request: TaskRequest) -> Result<(), String> {
	let db = WorkspaceDb::open(&request.path)?;
	let task = request.task;
	let ws_id = get_workspace_id(&db)?;

	db.conn
		.execute(
			"UPDATE tasks SET title = ?1, description = ?2, status = ?3, priority = ?4,
			 due_date = ?5, assignee_id = ?6, updated_at = ?7
			 WHERE id = ?8 AND workspace_id = ?9",
			rusqlite::params![
				&task.title, &task.description, &task.status, &task.priority,
				&task.due_date, &task.assignee_id, &task.updated_at,
				&task.id, &ws_id,
			],
		)
		.map_err(|e| e.to_string())?;

	Ok(())
}

/// Deletes a task by id.
#[tauri::command]
pub fn delete_task(request: TaskIdRequest) -> Result<(), String> {
	let db = WorkspaceDb::open(&request.path)?;
	let ws_id = get_workspace_id(&db)?;

	db.conn
		.execute(
			"DELETE FROM tasks WHERE id = ?1 AND workspace_id = ?2",
			[&request.id, &ws_id],
		)
		.map_err(|e| e.to_string())?;

	Ok(())
}

// ────────────────────────────
// Tauri commands — Kanban CRUD
// ────────────────────────────

/// Returns the full Kanban board (columns with nested cards).
#[tauri::command]
pub fn get_kanban(path: String) -> Result<Vec<KanbanColumn>, String> {
	let db = WorkspaceDb::open(&path)?;
	let ws_id = get_workspace_id(&db)?;

	// Load columns in position order.
	let mut columns: Vec<KanbanColumn> = db
		.conn
		.prepare(
			"SELECT id, title, position FROM kanban_columns
			 WHERE workspace_id = ?1 ORDER BY position ASC, created_at ASC",
		)
		.map_err(|e| e.to_string())?
		.query_map([&ws_id], |r| {
			Ok(KanbanColumn {
				id: r.get(0)?,
				title: r.get(1)?,
				position: r.get(2)?,
				cards: vec![],
			})
		})
		.map_err(|e| e.to_string())?
		.filter_map(|r| r.ok())
		.collect();

	// Load cards, grouped by column.
	for col in &mut columns {
		let cards: Vec<KanbanCard> = db
			.conn
			.prepare(
				"SELECT id, title, description, column_id, position, created_at, updated_at
				 FROM kanban_cards WHERE column_id = ?1 ORDER BY position ASC",
			)
			.map_err(|e| e.to_string())?
			.query_map([&col.id], |r| {
				Ok(KanbanCard {
					id: r.get(0)?,
					title: r.get(1)?,
					description: r.get(2)?,
					column_id: r.get(3)?,
					position: r.get(4)?,
					created_at: r.get(5)?,
					updated_at: r.get(6)?,
				})
			})
			.map_err(|e| e.to_string())?
			.filter_map(|r| r.ok())
			.collect();

		col.cards = cards;
	}

	Ok(columns)
}

/// Creates a new Kanban column.  `created_at` / `updated_at` are set
/// server-side so the frontend does not need to manage them for columns.
#[tauri::command]
pub fn create_kanban_column(request: KanbanColumnRequest) -> Result<KanbanColumn, String> {
	let db = WorkspaceDb::open(&request.path)?;
	let col = request.column;
	let ws_id = get_workspace_id(&db)?;
	let now = chrono::Utc::now().to_rfc3339();

	db.conn.execute(
		"INSERT INTO kanban_columns (id, workspace_id, title, position, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
		rusqlite::params![
			&col.id, &ws_id, &col.title, &col.position, &now, &now,
		],
	)
	.map_err(|e| e.to_string())?;

	Ok(col)
}

/// Creates a new Kanban card in the specified column.
#[tauri::command]
pub fn create_kanban_card(request: KanbanCardRequest) -> Result<KanbanCard, String> {
	let db = WorkspaceDb::open(&request.path)?;
	let card = request.card;
	let ws_id = get_workspace_id(&db)?;

	db.conn.execute(
		"INSERT INTO kanban_cards (id, workspace_id, column_id, title, description,
		 position, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
		rusqlite::params![
			&card.id, &ws_id, &card.column_id, &card.title,
			&card.description, &card.position,
			&card.created_at, &card.updated_at,
		],
	)
	.map_err(|e| e.to_string())?;

	Ok(card)
}

/// Updates a Kanban card.
#[tauri::command]
pub fn update_kanban_card(request: KanbanCardRequest) -> Result<(), String> {
	let db = WorkspaceDb::open(&request.path)?;
	let card = request.card;
	let ws_id = get_workspace_id(&db)?;

	db.conn
		.execute(
			"UPDATE kanban_cards SET title = ?1, description = ?2, column_id = ?3,
			 position = ?4, updated_at = ?5
			 WHERE id = ?6 AND workspace_id = ?7",
			rusqlite::params![
				&card.title, &card.description, &card.column_id,
				&card.position, &card.updated_at,
				&card.id, &ws_id,
			],
		)
		.map_err(|e| e.to_string())?;

	Ok(())
}

/// Moves a card to a different column / position.
#[tauri::command]
pub fn move_kanban_card(request: MoveCardRequest) -> Result<(), String> {
	let db = WorkspaceDb::open(&request.path)?;
	let ws_id = get_workspace_id(&db)?;

	db.conn
		.execute(
			"UPDATE kanban_cards SET column_id = ?1, position = ?2
			 WHERE id = ?3 AND workspace_id = ?4",
			rusqlite::params![&request.column_id, &request.position, &request.card_id, &ws_id],
		)
		.map_err(|e| e.to_string())?;

	Ok(())
}

/// Deletes a Kanban column (and its cards via cascade).
#[tauri::command]
pub fn delete_kanban_column(request: TaskIdRequest) -> Result<(), String> {
	let db = WorkspaceDb::open(&request.path)?;
	let ws_id = get_workspace_id(&db)?;

	db.conn
		.execute(
			"DELETE FROM kanban_columns WHERE id = ?1 AND workspace_id = ?2",
			[&request.id, &ws_id],
		)
		.map_err(|e| e.to_string())?;

	Ok(())
}

/// Deletes a Kanban card by id.
#[tauri::command]
pub fn delete_kanban_card(request: TaskIdRequest) -> Result<(), String> {
	let db = WorkspaceDb::open(&request.path)?;
	let ws_id = get_workspace_id(&db)?;

	db.conn
		.execute(
			"DELETE FROM kanban_cards WHERE id = ?1 AND workspace_id = ?2",
			[&request.id, &ws_id],
		)
		.map_err(|e| e.to_string())?;

	Ok(())
}
