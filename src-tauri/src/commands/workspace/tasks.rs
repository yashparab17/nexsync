//! Task CRUD commands backed by SQLite.

use crate::commands::config::validate_allowed_root;
use super::helpers::get_workspace_id;
use super::crdt;
use super::models::{json_list, to_json, valid_comments, valid_tags, Task, TaskIdRequest, TaskRequest};
use crate::commands::validation::{validate_task_priority, validate_task_status};

// ────────────────────────────
// Tauri commands — Task CRUD
// ────────────────────────────

/// Fetches all tasks for the workspace
#[tauri::command]
pub fn get_tasks(app_handle: tauri::AppHandle, path: String, with_state: Option<bool>) -> Result<Vec<Task>, String> {
    validate_allowed_root(&app_handle, &path)?;
    
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&path, ".")?;
    let db = crate::database::WorkspaceDb::open_existing(&path)?;
    let ws_id: String = get_workspace_id(&db)?;
    let mut tasks: Vec<Task> = db
        .conn
        .prepare(
            "SELECT id, title, description, status, priority, due_date, assignee_id,
             created_at, updated_at, tags, comments
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
                tags: json_list(&r.get::<_, String>(9)?),
                comments: json_list(&r.get::<_, String>(10)?),
                ..Default::default()
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    crdt::attach_conflicts(&db.conn, &mut tasks)?;
    super::invariants::attach(&db.conn, &mut tasks)?;
    if with_state.unwrap_or(false) {
        for t in &mut tasks {
            crdt::attach(&db.conn, t)?;
        }
    }
    Ok(tasks)
}

/// Creates a new task in the workspace database
#[tauri::command]
pub fn create_task(app_handle: tauri::AppHandle, request: TaskRequest) -> Result<Task, String> {
    validate_allowed_root(&app_handle, &request.path)?;
    
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    validate_task_status(&request.task.status)?;
    validate_task_priority(&request.task.priority)?;
    if !valid_tags(&request.task.tags) {
        return Err("A task can have up to 10 tags of 32 characters each.".to_string());
    }
    if !valid_comments(&request.task.comments) {
        return Err("A task can have up to 200 comments of 2000 characters each.".to_string());
    }

    // Enforce field bounds
    if request.task.title.is_empty() || request.task.title.len() > 256 {
        return Err("Task title must be between 1 and 256 characters.".to_string());
    }
    if request.task.description.len() > 32768 {
        return Err("Task description cannot exceed 32 KB.".to_string());
    }
    if request.task.id.len() > 64 {
        return Err("Task ID exceeds maximum allowed length.".to_string());
    }

    let db = crate::database::WorkspaceDb::open_existing(&request.path)?;
    let task = request.task;
    let author = request.author;
    let ws_id = get_workspace_id(&db)?;
    db.conn.execute(
        "INSERT INTO tasks (id, workspace_id, title, description, status, priority,
         due_date, assignee_id, created_at, updated_at, tags, comments)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            &task.id, &ws_id, &task.title, &task.description,
            &task.status, &task.priority, &task.due_date,
            &task.assignee_id, &task.created_at, &task.updated_at, to_json(&task.tags),
            to_json(&task.comments),
        ],
    )
    .map_err(|e| e.to_string())?;
    super::data_sync::clear_tombstone(&db.conn, super::data_sync::ENTITY_TASK, &task.id)?;
    crdt::record_write(&db.conn, &task, author.as_deref(), None)?;
    Ok(task)
}

/// Updates an existing task in the workspace database
#[tauri::command]
pub fn update_task(app_handle: tauri::AppHandle, request: TaskRequest) -> Result<(), String> {
    validate_allowed_root(&app_handle, &request.path)?;
    
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    validate_task_status(&request.task.status)?;
    validate_task_priority(&request.task.priority)?;
    if !valid_tags(&request.task.tags) {
        return Err("A task can have up to 10 tags of 32 characters each.".to_string());
    }
    if !valid_comments(&request.task.comments) {
        return Err("A task can have up to 200 comments of 2000 characters each.".to_string());
    }

    if request.task.title.is_empty() || request.task.title.len() > 256 {
        return Err("Task title must be between 1 and 256 characters.".to_string());
    }
    if request.task.description.len() > 32768 {
        return Err("Task description cannot exceed 32 KB.".to_string());
    }
    if request.task.id.len() > 64 {
        return Err("Task ID exceeds maximum allowed length.".to_string());
    }

    let db = crate::database::WorkspaceDb::open_existing(&request.path)?;
    let task = request.task;
    let author = request.author;
    let base = request.base;
    let ws_id = get_workspace_id(&db)?;
    let Some(existing) = super::data_sync::read_task(&db.conn, &task.id)? else { return Ok(()) };
    // A task from before per-field merging gets its state from what it held before this change
    crdt::ensure(&db.conn, &existing)?;
    // The row becomes whatever merging says the task is now: the edited copy only where the person changed it
    let row = crdt::apply_local(&db.conn, &task, Some(&existing), base.as_ref(), author.as_deref())?;
    super::data_sync::put_task_row(&db.conn, &ws_id, &row)?;
    Ok(())
}

/// Deletes a task by ID from the workspace database
#[tauri::command]
pub fn delete_task(app_handle: tauri::AppHandle, request: TaskIdRequest) -> Result<(), String> {
    validate_allowed_root(&app_handle, &request.path)?;
    
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open_existing(&request.path)?;
    let ws_id = get_workspace_id(&db)?;
    delete_task_row(&db.conn, &ws_id, &request.id)
}

/// Deletes a task: its row, a tombstone so peers do not bring it back, and its merge state
pub(super) fn delete_task_row(conn: &rusqlite::Connection, ws_id: &str, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM tasks WHERE id = ?1 AND workspace_id = ?2", [id, ws_id]).map_err(|e| e.to_string())?;
    super::data_sync::record_tombstone(conn, ws_id, super::data_sync::ENTITY_TASK, id)?;
    crdt::forget(conn, <Task as crdt::Crdt>::ENTITY, id)?;
    Ok(())
}