use std::fs;
use std::path::Path;

use chrono::Utc;
use uuid::Uuid;

use crate::database::WorkspaceDb;
use crate::commands::path_utils::resolve_workspace_path;
use crate::commands::validation::validate_member_role;
use super::helpers::get_workspace_id;
use super::loaders::{load_activity, load_history, load_permissions};
use super::models::{CreateWorkspaceRequest, History, Permissions, WorkspaceInfo, WorkspaceMetadata, UpdateMetadataRequest, Members, Member, Settings};

// ────────────────────────────
// Tauri commands — Workspace creation / import
// ────────────────────────────

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

    let permissions = Permissions {
        owner: vec!["create".into(), "delete".into(), "invite".into(), "edit".into()],
        editor: vec!["edit".into(), "create".into()],
        viewer: vec!["view".into()],
    };

    let history = History {
        last_opened: now.clone(),
        recent_files: vec![],
    };

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

    let folders = ["notes", "files", "tasks", "kanban", "editor", "assets"];
    for folder in folders {
        fs::create_dir_all(workspace_path.join(folder)).map_err(|e| e.to_string())?;
    }

    Ok(workspace)
}

#[tauri::command]
pub fn import_workspace(path: String) -> Result<WorkspaceInfo, String> {
    let _canonical_path = resolve_workspace_path(&path, ".")?;
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
            |r| Ok(WorkspaceInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                path: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            }),
        )
        .map_err(|_| format!("Failed to read workspace metadata."))?;
    let mut workspace = workspace;
    workspace.path = path;
    Ok(workspace)
}

// ────────────────────────────
// Tauri commands — Workspace metadata read / write
// ────────────────────────────

#[tauri::command]
pub fn read_workspace_metadata(path: String) -> Result<WorkspaceMetadata, String> {
    let _canonical_path = resolve_workspace_path(&path, ".")?;
    let workspace_path = Path::new(&path);
    if !workspace_path.exists() {
        return Err("The workspace path does not exist.".to_string());
    }
    let db = WorkspaceDb::open(&path)?;
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
        .map_err(|_| format!("workspace table is empty."))?;

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

#[tauri::command]
pub fn write_workspace_metadata(request: UpdateMetadataRequest) -> Result<(), String> {
    let _canonical_path = resolve_workspace_path(&request.path, ".")?;
    let db = WorkspaceDb::open(&request.path)?;
    let metadata = &request.metadata;
    let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;

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

    tx.execute("DELETE FROM members WHERE workspace_id = ?1", [&metadata.workspace.id])
        .map_err(|e| e.to_string())?;
    for m in &metadata.members.members {
        validate_member_role(&m.role).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO members (id, workspace_id, name, role) VALUES (?1, ?2, ?3, ?4)",
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

    tx.execute("DELETE FROM activity_events WHERE workspace_id = ?1", [&metadata.workspace.id])
        .map_err(|e| e.to_string())?;
    for e in &metadata.activity.events {
        tx.execute(
            "INSERT INTO activity_events (id, workspace_id, timestamp, action, detail, target, target_type)
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

#[tauri::command]
pub fn get_workspace_stats(path: String) -> Result<super::models::WorkspaceStats, String> {
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

    Ok(super::models::WorkspaceStats {
        files: count_entries("files") + count_entries("notes") + count_entries("editor"),
        assets: count_entries("assets"),
        tasks: task_count as usize,
        kanban_cards: kanban_count as usize,
        members: member_count as usize,
    })
}