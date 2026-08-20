use crate::commands::config::validate_allowed_root;

use super::helpers::get_workspace_id;
use super::models::{Task, TaskIdRequest, TaskRequest};
use crate::commands::validation::{validate_task_priority, validate_task_status};

// ────────────────────────────
// Tauri commands — Task CRUD
// ────────────────────────────

#[tauri::command]
pub fn get_tasks(app_handle: tauri::AppHandle, path: String) -> Result<Vec<Task>, String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &path)?;
    
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&path, ".")?;
    let db = crate::database::WorkspaceDb::open(&path)?;
    let ws_id: String = get_workspace_id(&db)?;
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

#[tauri::command]
pub fn create_task(app_handle: tauri::AppHandle, request: TaskRequest) -> Result<Task, String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &request.path)?;
    
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    validate_task_status(&request.task.status)?;
    validate_task_priority(&request.task.priority)?;
    let db = crate::database::WorkspaceDb::open(&request.path)?;
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

#[tauri::command]
pub fn update_task(app_handle: tauri::AppHandle, request: TaskRequest) -> Result<(), String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &request.path)?;
    
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    validate_task_status(&request.task.status)?;
    validate_task_priority(&request.task.priority)?;
    let db = crate::database::WorkspaceDb::open(&request.path)?;
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

#[tauri::command]
pub fn delete_task(app_handle: tauri::AppHandle, request: TaskIdRequest) -> Result<(), String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &request.path)?;
    
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open(&request.path)?;
    let ws_id = get_workspace_id(&db)?;
    db.conn
        .execute(
            "DELETE FROM tasks WHERE id = ?1 AND workspace_id = ?2",
            [&request.id, &ws_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}