use chrono::Utc;

use crate::commands::config::validate_allowed_root;

use super::helpers::get_workspace_id;
use super::models::{KanbanCard, KanbanColumn, KanbanCardRequest, KanbanColumnRequest, MoveCardRequest, TaskIdRequest};

// ────────────────────────────
// Tauri commands — Kanban CRUD
// ────────────────────────────

#[tauri::command]
pub fn get_kanban(app_handle: tauri::AppHandle, path: String) -> Result<Vec<KanbanColumn>, String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &path)?;
    
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&path, ".")?;
    let db = crate::database::WorkspaceDb::open_existing(&path)?;
    let ws_id: String = get_workspace_id(&db)?;
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

#[tauri::command]
pub fn create_kanban_column(app_handle: tauri::AppHandle, request: KanbanColumnRequest) -> Result<KanbanColumn, String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &request.path)?;
    
    // M6 FIX: Enforce bounds on Kanban column
    if request.column.title.is_empty() || request.column.title.len() > 128 {
        return Err("Kanban column title must be between 1 and 128 characters.".to_string());
    }
    if request.column.id.len() > 64 {
        return Err("Column ID exceeds maximum allowed length.".to_string());
    }

    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open_existing(&request.path)?;
    let col = request.column;
    let ws_id = get_workspace_id(&db)?;
    let now = Utc::now().to_rfc3339();
    db.conn.execute(
        "INSERT INTO kanban_columns (id, workspace_id, title, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![&col.id, &ws_id, &col.title, &col.position, &now, &now],
    )
    .map_err(|e| e.to_string())?;
    Ok(col)
}

#[tauri::command]
pub fn create_kanban_card(app_handle: tauri::AppHandle, request: KanbanCardRequest) -> Result<KanbanCard, String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &request.path)?;
    
    // M6 FIX: Enforce bounds on Kanban card
    if request.card.title.is_empty() || request.card.title.len() > 256 {
        return Err("Kanban card title must be between 1 and 256 characters.".to_string());
    }
    if request.card.description.len() > 32768 {
        return Err("Kanban card description cannot exceed 32 KB.".to_string());
    }
    if request.card.id.len() > 64 || request.card.column_id.len() > 64 {
        return Err("Card ID or column ID exceeds maximum allowed length.".to_string());
    }

    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open_existing(&request.path)?;
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

#[tauri::command]
pub fn update_kanban_card(app_handle: tauri::AppHandle, request: KanbanCardRequest) -> Result<(), String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &request.path)?;
    
    // M6 FIX: Enforce bounds on Kanban card
    if request.card.title.is_empty() || request.card.title.len() > 256 {
        return Err("Kanban card title must be between 1 and 256 characters.".to_string());
    }
    if request.card.description.len() > 32768 {
        return Err("Kanban card description cannot exceed 32 KB.".to_string());
    }
    if request.card.id.len() > 64 || request.card.column_id.len() > 64 {
        return Err("Card ID or column ID exceeds maximum allowed length.".to_string());
    }

    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open_existing(&request.path)?;
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

#[tauri::command]
pub fn move_kanban_card(app_handle: tauri::AppHandle, request: MoveCardRequest) -> Result<(), String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &request.path)?;
    
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open_existing(&request.path)?;
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

#[tauri::command]
pub fn delete_kanban_column(app_handle: tauri::AppHandle, request: TaskIdRequest) -> Result<(), String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &request.path)?;
    
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open_existing(&request.path)?;
    let ws_id = get_workspace_id(&db)?;
    db.conn
        .execute(
            "DELETE FROM kanban_columns WHERE id = ?1 AND workspace_id = ?2",
            [&request.id, &ws_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_kanban_card(app_handle: tauri::AppHandle, request: TaskIdRequest) -> Result<(), String> {
    // Validate that the workspace path is within allowed roots
    validate_allowed_root(&app_handle, &request.path)?;
    
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open_existing(&request.path)?;
    let ws_id = get_workspace_id(&db)?;
    db.conn
        .execute(
            "DELETE FROM kanban_cards WHERE id = ?1 AND workspace_id = ?2",
            [&request.id, &ws_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}