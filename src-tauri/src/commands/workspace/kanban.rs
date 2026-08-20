use chrono::Utc;

use super::helpers::get_workspace_id;
use super::models::{KanbanCard, KanbanColumn, KanbanCardRequest, KanbanColumnRequest, MoveCardRequest, TaskIdRequest};

// ────────────────────────────
// Tauri commands — Kanban CRUD
// ────────────────────────────

#[tauri::command]
pub fn get_kanban(path: String) -> Result<Vec<KanbanColumn>, String> {
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&path, ".")?;
    let db = crate::database::WorkspaceDb::open(&path)?;
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
pub fn create_kanban_column(request: KanbanColumnRequest) -> Result<KanbanColumn, String> {
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open(&request.path)?;
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
pub fn create_kanban_card(request: KanbanCardRequest) -> Result<KanbanCard, String> {
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open(&request.path)?;
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
pub fn update_kanban_card(request: KanbanCardRequest) -> Result<(), String> {
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open(&request.path)?;
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
pub fn move_kanban_card(request: MoveCardRequest) -> Result<(), String> {
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open(&request.path)?;
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
pub fn delete_kanban_column(request: TaskIdRequest) -> Result<(), String> {
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open(&request.path)?;
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
pub fn delete_kanban_card(request: TaskIdRequest) -> Result<(), String> {
    let _canonical_path = crate::commands::path_utils::resolve_workspace_path(&request.path, ".")?;
    let db = crate::database::WorkspaceDb::open(&request.path)?;
    let ws_id = get_workspace_id(&db)?;
    db.conn
        .execute(
            "DELETE FROM kanban_cards WHERE id = ?1 AND workspace_id = ?2",
            [&request.id, &ws_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}