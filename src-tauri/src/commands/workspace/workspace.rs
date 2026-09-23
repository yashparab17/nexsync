//! Workspace lifecycle commands (create, import, metadata read/write, statistics).

use std::fs;
use std::path::Path;

use chrono::Utc;
use uuid::Uuid;

use crate::database::WorkspaceDb;
use crate::commands::path_utils::resolve_workspace_path;
use crate::commands::validation::validate_member_role;
use crate::commands::config::validate_allowed_root;
use super::helpers::{get_workspace_id, validate_workspace_item_name};
use super::loaders::{load_activity, load_history, load_permissions};
use super::models::{CreateWorkspaceRequest, History, Permissions, WorkspaceInfo, WorkspaceMetadata, UpdateMetadataRequest, Members, Member, Settings};

// ────────────────────────────
// Tauri commands — Workspace creation / import
// ────────────────────────────

/// Creates a new workspace on disk and initializes its SQLite database
#[tauri::command]
pub fn create_workspace(app_handle: tauri::AppHandle, request: CreateWorkspaceRequest) -> Result<WorkspaceInfo, String> {
    // Validate workspace name and root paths
    validate_workspace_item_name(&request.name)?;
    validate_allowed_root(&app_handle, &request.path)?;
    
    let workspace_path = Path::new(&request.path).join(&request.name);
    validate_allowed_root(&app_handle, workspace_path.to_string_lossy().as_ref())?;

    let workspace_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    // Create directories
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

    let permissions = Permissions {
        owner: vec!["create".into(), "delete".into(), "invite".into(), "edit".into()],
        editor: vec!["edit".into(), "create".into()],
        viewer: vec!["view".into()],
    };

    let history = History {
        last_opened: now.clone(),
        recent_files: vec![],
    };

    // Initialize database records in a transaction
    let db = WorkspaceDb::open(&workspace.path)?;
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
        validate_member_role(&m.role).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO members (id, workspace_id, name, role) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![&m.id, &workspace.id, &m.name, &m.role],
        )
        .map_err(|e| e.to_string())?;
    }

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

    // Create default content folders
    let folders = ["notes", "files", "tasks", "kanban", "editor", "assets"];
    for folder in folders {
        fs::create_dir_all(workspace_path.join(folder)).map_err(|e| e.to_string())?;
    }

    Ok(workspace)
}

/// Imports an existing workspace from disk
#[tauri::command]
pub fn import_workspace(app_handle: tauri::AppHandle, path: String) -> Result<WorkspaceInfo, String> {
    validate_allowed_root(&app_handle, &path)?;
    
    let workspace_path = Path::new(&path);
    if !workspace_path.exists() {
        return Err("The selected folder does not exist.".to_string());
    }
    
    let nexsync_dir = workspace_path.join(".nexsync");
    let nexsync_db = nexsync_dir.join("nexsync.db");
    if !nexsync_dir.exists() || !nexsync_db.is_file() {
        return Err("Invalid workspace: No valid '.nexsync/nexsync.db' found. \
        Please select an existing Nexsync workspace folder."
            .to_string()
        );
    }
    
    let db = WorkspaceDb::open_existing(&path)?;
    let workspace: WorkspaceInfo = db
        .conn
        .query_row(
            "SELECT id, name, description, path, created_at, updated_at FROM workspace",
            [],
            |r| Ok(WorkspaceInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                path: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            }),
        )
        .map_err(|_| "Failed to read workspace metadata.".to_string())?;
    let mut workspace = workspace;
    workspace.path = path;
    Ok(workspace)
}

// ────────────────────────────
// Tauri commands — Workspace metadata read / write
// ────────────────────────────

/// Loads complete workspace metadata from SQLite database
#[tauri::command]
pub fn read_workspace_metadata(app_handle: tauri::AppHandle, path: String) -> Result<WorkspaceMetadata, String> {
    validate_allowed_root(&app_handle, &path)?;
    
    let _canonical_path = resolve_workspace_path(&path, ".")?;
    let workspace_path = Path::new(&path);
    if !workspace_path.exists() {
        return Err("The workspace path does not exist.".to_string());
    }
    let db = WorkspaceDb::open_existing(&path)?;
    let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let workspace: WorkspaceInfo = tx
        .query_row(
            "SELECT id, name, description, path, created_at, updated_at FROM workspace",
            [],
            |r| Ok(WorkspaceInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                path: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            }),
        )
        .map_err(|_| "workspace table is empty.".to_string())?;

    let theme: String = tx
        .query_row("SELECT theme FROM settings WHERE workspace_id = ?1", [&workspace.id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let autosave: i64 = tx
        .query_row("SELECT autosave FROM settings WHERE workspace_id = ?1", [&workspace.id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let sync: i64 = tx
        .query_row("SELECT sync FROM settings WHERE workspace_id = ?1", [&workspace.id], |r| r.get(0))
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

/// Persists workspace metadata updates to SQLite database
#[tauri::command]
pub fn write_workspace_metadata(app_handle: tauri::AppHandle, request: UpdateMetadataRequest) -> Result<(), String> {
    validate_allowed_root(&app_handle, &request.path)?;
    
    let canonical_path = resolve_workspace_path(&request.path, ".")?;
    let canonical_path_str = canonical_path.to_string_lossy().to_string();

    let db = WorkspaceDb::open_existing(&request.path)?;
    persist_metadata(&db, &canonical_path_str, &request.metadata)
}

/// Writes metadata in one transaction without disturbing tasks, kanban or other child rows
fn persist_metadata(db: &WorkspaceDb, canonical_path_str: &str, metadata: &WorkspaceMetadata) -> Result<(), String> {
    // A second workspace row would break every query that expects exactly one
    if let Ok(existing_id) = get_workspace_id(db) {
        if existing_id != metadata.workspace.id {
            return Err("Workspace ID mismatch - metadata belongs to a different workspace.".to_string());
        }
    }

    let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;

    // Check overall metadata payload size
    const MAX_METADATA_SIZE: usize = 1024 * 1024; // 1 MB
    let metadata_json = serde_json::to_string(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    if metadata_json.len() > MAX_METADATA_SIZE {
        return Err(format!(
            "Metadata too large ({} bytes). Maximum allowed is {} bytes.",
            metadata_json.len(),
            MAX_METADATA_SIZE
        ));
    }

    // Upsert, not REPLACE: REPLACE deletes the row first, which cascades to every task, card and member
    tx.execute(
        "INSERT INTO workspace (id, name, description, path, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
             path = excluded.path, created_at = excluded.created_at, updated_at = excluded.updated_at",
        rusqlite::params![
            &metadata.workspace.id,
            &metadata.workspace.name,
            &metadata.workspace.description,
            &canonical_path_str,
            &metadata.workspace.created_at,
            &metadata.workspace.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;

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

    // Keep surviving member rows in place so task assignees aren't cleared on every save
    let member_ids = serde_json::to_string(
        &metadata.members.members.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM members WHERE workspace_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2))",
        rusqlite::params![&metadata.workspace.id, &member_ids],
    )
    .map_err(|e| e.to_string())?;
    // Clear names first so renames that swap names don't trip UNIQUE(workspace_id, name)
    tx.execute(
        "UPDATE members SET name = '~' || id WHERE workspace_id = ?1",
        [&metadata.workspace.id],
    )
    .map_err(|e| e.to_string())?;
    for m in &metadata.members.members {
        validate_member_role(&m.role).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO members (id, workspace_id, name, role) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role",
            rusqlite::params![&m.id, &metadata.workspace.id, &m.name, &m.role],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.execute("DELETE FROM permissions WHERE workspace_id = ?1", [&metadata.workspace.id])
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

    // Restrict activity events length
    const MAX_ACTIVITY_EVENTS: usize = 500;
    let activity_events = &metadata.activity.events;
    if activity_events.len() > MAX_ACTIVITY_EVENTS {
        return Err(format!(
            "Too many activity events ({}). Maximum allowed is {}.",
            activity_events.len(),
            MAX_ACTIVITY_EVENTS
        ));
    }

    let recent_files_json = serde_json::to_string(&metadata.history.recent_files).unwrap_or_default();
    tx.execute(
        "INSERT OR REPLACE INTO history (workspace_id, last_opened, recent_files) VALUES (?1, ?2, ?3)",
        rusqlite::params![
            &metadata.workspace.id,
            &metadata.history.last_opened,
            recent_files_json,
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM activity_events WHERE id NOT IN (SELECT id FROM activity_events ORDER BY timestamp DESC LIMIT ?)",
        [MAX_ACTIVITY_EVENTS as i64],
    )
    .map_err(|e| e.to_string())?;

    for e in activity_events {
        if e.action.len() > 64 || e.detail.len() > 1024 {
            return Err("Activity event action or detail exceeds maximum allowed length.".to_string());
        }
        if let Some(target) = &e.target {
            if target.len() > 512 || target.contains("..") || target.contains('\0') {
                return Err("Invalid or potentially unsafe activity target path.".to_string());
            }
        }
        if let Some(target_type) = &e.target_type {
            if target_type.len() > 64 {
                return Err("Activity event target_type exceeds maximum allowed length.".to_string());
            }
        }

        tx.execute(
            "INSERT OR REPLACE INTO activity_events (id, workspace_id, timestamp, action, detail, target, target_type)
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

/// Retrieves aggregate metrics for files, tasks, and members in the workspace
#[tauri::command]
pub fn get_workspace_stats(app_handle: tauri::AppHandle, path: String) -> Result<super::models::WorkspaceStats, String> {
    validate_allowed_root(&app_handle, &path)?;
    
    let _canonical_path = resolve_workspace_path(&path, ".")?;
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

    let db = WorkspaceDb::open_existing(&path)?;
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

    Ok(super::models::WorkspaceStats {
        files: count_entries("files") + count_entries("notes") + count_entries("editor"),
        assets: count_entries("assets"),
        tasks: task_count as usize,
        kanban_cards: kanban_count as usize,
        members: member_count as usize,
    })
}
#[cfg(test)]
mod tests {
    use super::*;

    fn metadata(members: serde_json::Value) -> WorkspaceMetadata {
        serde_json::from_value(serde_json::json!({
            "workspace": { "id": "ws-1", "name": "Demo", "description": "", "path": "",
                           "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z" },
            "settings": { "theme": "dark", "autosave": true, "sync": true },
            "members": { "members": members },
            "activity": { "events": [{ "id": "ev-1", "timestamp": "2026-01-02T00:00:00Z",
                                       "action": "Created task", "detail": "Created task: A" }] },
            "permissions": { "owner": ["edit"], "editor": ["edit"], "viewer": ["view"] },
            "history": { "last_opened": "2026-01-02T00:00:00Z", "recent_files": [] }
        }))
        .unwrap()
    }

    fn count(db: &WorkspaceDb, table: &str) -> i64 {
        db.conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn test_saving_metadata_keeps_tasks_kanban_and_assignees() {
        let dir = std::env::temp_dir().join(format!("nexsync-meta-{}", Uuid::new_v4()));
        let db = WorkspaceDb::open(dir.to_str().unwrap()).unwrap();
        let path = dir.to_string_lossy().to_string();
        let owner = serde_json::json!({ "id": "owner", "name": "User", "role": "Owner" });
        let friend = serde_json::json!({ "id": "m-2", "name": "Friend", "role": "Editor" });
        persist_metadata(&db, &path, &metadata(serde_json::json!([owner, friend]))).unwrap();

        db.conn
            .execute_batch(
                "INSERT INTO tasks (id, workspace_id, title, description, status, priority, assignee_id, created_at, updated_at)
                     VALUES ('t-1', 'ws-1', 'A', '', 'todo', 'medium', 'm-2', 'x', 'x');
                 INSERT INTO kanban_columns (id, workspace_id, title, position, created_at, updated_at)
                     VALUES ('c-1', 'ws-1', 'To Do', 0, 'x', 'x');
                 INSERT INTO kanban_cards (id, workspace_id, column_id, title, description, position, created_at, updated_at)
                     VALUES ('k-1', 'ws-1', 'c-1', 'Card', '', 0, 'x', 'x');",
            )
            .unwrap();

        // Saving again (as every activity event does) must not cascade-delete anything
        let owner = serde_json::json!({ "id": "owner", "name": "Host", "role": "Owner" });
        persist_metadata(&db, &path, &metadata(serde_json::json!([owner, friend]))).unwrap();
        assert_eq!(count(&db, "workspace"), 1);
        assert_eq!(count(&db, "tasks"), 1);
        assert_eq!(count(&db, "kanban_columns"), 1);
        assert_eq!(count(&db, "kanban_cards"), 1);
        let assignee: Option<String> = db
            .conn
            .query_row("SELECT assignee_id FROM tasks WHERE id = 't-1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(assignee.as_deref(), Some("m-2"));
        let owner_name: String = db
            .conn
            .query_row("SELECT name FROM members WHERE id = 'owner'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(owner_name, "Host");

        // Swapping two names must not trip UNIQUE(workspace_id, name); removed members go away
        let a = serde_json::json!({ "id": "owner", "name": "Friend", "role": "Owner" });
        let b = serde_json::json!({ "id": "m-2", "name": "Host", "role": "Editor" });
        persist_metadata(&db, &path, &metadata(serde_json::json!([a, b]))).unwrap();
        persist_metadata(&db, &path, &metadata(serde_json::json!([a]))).unwrap();
        assert_eq!(count(&db, "members"), 1);
        assert_eq!(count(&db, "tasks"), 1);

        // Metadata for another workspace is refused instead of adding a second row
        let mut other = metadata(serde_json::json!([a]));
        other.workspace.id = "ws-2".into();
        assert!(persist_metadata(&db, &path, &other).is_err());

        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
