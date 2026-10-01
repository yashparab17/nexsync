//! Kanban board columns and cards CRUD commands.

use chrono::Utc;
use crate::commands::config::validate_allowed_root;
use super::helpers::get_workspace_id;
use super::models::{json_list, to_json, valid_checklist, valid_comments, valid_tags, KanbanCard, KanbanColumn, KanbanCardRequest, KanbanColumnRequest, MoveCardRequest, TaskIdRequest};

// ────────────────────────────
// Tauri commands — Kanban CRUD
// ────────────────────────────

/// Fetches all Kanban columns and their ordered cards
#[tauri::command]
pub fn get_kanban(app_handle: tauri::AppHandle, path: String) -> Result<Vec<KanbanColumn>, String> {
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
                "SELECT id, title, description, column_id, position, created_at, updated_at,
                 tags, due_date, assignee_id, checklist, comments
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
                    tags: json_list(&r.get::<_, String>(7)?),
                    due_date: r.get(8)?,
                    assignee_id: r.get(9)?,
                    checklist: json_list(&r.get::<_, String>(10)?),
                    comments: json_list(&r.get::<_, String>(11)?),
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        col.cards = cards;
    }
    Ok(columns)
}

/// Creates a new Kanban column
#[tauri::command]
pub fn create_kanban_column(app_handle: tauri::AppHandle, request: KanbanColumnRequest) -> Result<KanbanColumn, String> {
    validate_allowed_root(&app_handle, &request.path)?;
    
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
    super::data_sync::clear_tombstone(&db.conn, super::data_sync::ENTITY_COLUMN, &col.id)?;
    Ok(col)
}

/// Creates a new card inside a Kanban column
#[tauri::command]
pub fn create_kanban_card(app_handle: tauri::AppHandle, request: KanbanCardRequest) -> Result<KanbanCard, String> {
    validate_allowed_root(&app_handle, &request.path)?;
    
    if request.card.title.is_empty() || request.card.title.len() > 256 {
        return Err("Kanban card title must be between 1 and 256 characters.".to_string());
    }
    if request.card.description.len() > 32768 {
        return Err("Kanban card description cannot exceed 32 KB.".to_string());
    }
    if request.card.id.len() > 64 || request.card.column_id.len() > 64 {
        return Err("Card ID or column ID exceeds maximum allowed length.".to_string());
    }
    if !valid_tags(&request.card.tags) {
        return Err("A card can have up to 10 tags of 32 characters each.".to_string());
    }
    if !valid_comments(&request.card.comments) {
        return Err("A card can have up to 200 comments of 2000 characters each.".to_string());
    }
    if !valid_checklist(&request.card.checklist) {
        return Err("A checklist can have up to 50 items of 256 characters each.".to_string());
    }

    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open_existing(&request.path)?;
    let card = request.card;
    let ws_id = get_workspace_id(&db)?;
    db.conn.execute(
        "INSERT INTO kanban_cards (id, workspace_id, column_id, title, description,
         position, created_at, updated_at, tags, due_date, assignee_id, checklist, comments)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            &card.id, &ws_id, &card.column_id, &card.title,
            &card.description, &card.position,
            &card.created_at, &card.updated_at,
            to_json(&card.tags), &card.due_date, &card.assignee_id, to_json(&card.checklist),
            to_json(&card.comments),
        ],
    )
    .map_err(|e| e.to_string())?;
    super::data_sync::clear_tombstone(&db.conn, super::data_sync::ENTITY_CARD, &card.id)?;
    Ok(card)
}

/// Updates title, description, or column assignment for a Kanban card
#[tauri::command]
pub fn update_kanban_card(app_handle: tauri::AppHandle, request: KanbanCardRequest) -> Result<(), String> {
    validate_allowed_root(&app_handle, &request.path)?;
    
    if request.card.title.is_empty() || request.card.title.len() > 256 {
        return Err("Kanban card title must be between 1 and 256 characters.".to_string());
    }
    if request.card.description.len() > 32768 {
        return Err("Kanban card description cannot exceed 32 KB.".to_string());
    }
    if request.card.id.len() > 64 || request.card.column_id.len() > 64 {
        return Err("Card ID or column ID exceeds maximum allowed length.".to_string());
    }
    if !valid_tags(&request.card.tags) {
        return Err("A card can have up to 10 tags of 32 characters each.".to_string());
    }
    if !valid_comments(&request.card.comments) {
        return Err("A card can have up to 200 comments of 2000 characters each.".to_string());
    }
    if !valid_checklist(&request.card.checklist) {
        return Err("A checklist can have up to 50 items of 256 characters each.".to_string());
    }

    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open_existing(&request.path)?;
    let card = request.card;
    let ws_id = get_workspace_id(&db)?;
    db.conn
        .execute(
            "UPDATE kanban_cards SET title = ?1, description = ?2, column_id = ?3,
             position = ?4, updated_at = ?5, tags = ?8, due_date = ?9, assignee_id = ?10, checklist = ?11, comments = ?12
             WHERE id = ?6 AND workspace_id = ?7",
            rusqlite::params![
                &card.title, &card.description, &card.column_id,
                &card.position, &card.updated_at,
                &card.id, &ws_id,
                to_json(&card.tags), &card.due_date, &card.assignee_id, to_json(&card.checklist),
                to_json(&card.comments),
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Moves a card to a new column and position
#[tauri::command]
pub fn move_kanban_card(app_handle: tauri::AppHandle, request: MoveCardRequest) -> Result<(), String> {
    validate_allowed_root(&app_handle, &request.path)?;
    
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open_existing(&request.path)?;
    let ws_id = get_workspace_id(&db)?;
    db.conn
        .execute(
            "UPDATE kanban_cards SET column_id = ?1, position = ?2, updated_at = ?5
             WHERE id = ?3 AND workspace_id = ?4",
            rusqlite::params![&request.column_id, &request.position, &request.card_id, &ws_id, Utc::now().to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Deletes a Kanban column and all cards in it
#[tauri::command]
pub fn delete_kanban_column(app_handle: tauri::AppHandle, request: TaskIdRequest) -> Result<(), String> {
    validate_allowed_root(&app_handle, &request.path)?;
    
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open_existing(&request.path)?;
    let ws_id = get_workspace_id(&db)?;
    // Cards die with their column, so mark them deleted too.
    let card_ids: Vec<String> = db
        .conn
        .prepare("SELECT id FROM kanban_cards WHERE column_id = ?1")
        .map_err(|e| e.to_string())?
        .query_map([&request.id], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    for id in &card_ids {
        super::data_sync::record_tombstone(&db.conn, &ws_id, super::data_sync::ENTITY_CARD, id)?;
    }
    db.conn
        .execute(
            "DELETE FROM kanban_columns WHERE id = ?1 AND workspace_id = ?2",
            [&request.id, &ws_id],
        )
        .map_err(|e| e.to_string())?;
    super::data_sync::record_tombstone(&db.conn, &ws_id, super::data_sync::ENTITY_COLUMN, &request.id)?;
    Ok(())
}

/// Deletes a single Kanban card
#[tauri::command]
pub fn delete_kanban_card(app_handle: tauri::AppHandle, request: TaskIdRequest) -> Result<(), String> {
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
    super::data_sync::record_tombstone(&db.conn, &ws_id, super::data_sync::ENTITY_CARD, &request.id)?;
    Ok(())
}