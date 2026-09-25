//! Yjs CRDT binary document persistence commands for SQLite.

use base64::prelude::*;
use chrono::Utc;

use crate::commands::config::validate_allowed_root;
use crate::database::WorkspaceDb;
use super::helpers::get_workspace_id;

/// Maximum allowed binary state snapshot size (25 MB)
const MAX_YJS_DOC_SIZE: usize = 25 * 1024 * 1024;

// ────────────────────────────
// Tauri commands — Yjs Persistence
// ────────────────────────────

/// Retrieves the base64-encoded binary CRDT state of a document from SQLite
#[tauri::command]
pub fn get_yjs_doc(
	app_handle: tauri::AppHandle,
	workspace_path: String,
	doc_id: String,
) -> Result<Option<String>, String> {
	validate_allowed_root(&app_handle, &workspace_path)?;

	if doc_id.is_empty() || doc_id.len() > 512 {
		return Err("Invalid document ID.".to_string());
	}

	let db = WorkspaceDb::open_existing(&workspace_path)?;
	let ws_id = get_workspace_id(&db)?;

	let result: Result<Vec<u8>, rusqlite::Error> = db.conn.query_row(
		"SELECT binary_state FROM yjs_documents WHERE workspace_id = ?1 AND doc_id = ?2",
		rusqlite::params![&ws_id, &doc_id],
		|r| r.get(0),
	);

	match result {
		Ok(blob) => Ok(Some(BASE64_STANDARD.encode(&blob))),
		Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
		Err(e) => Err(format!("Failed to retrieve Yjs document: {}", e)),
	}
}

/// Persists a document's binary CRDT state snapshot into SQLite
#[tauri::command]
pub fn save_yjs_doc(
	app_handle: tauri::AppHandle,
	workspace_path: String,
	doc_id: String,
	state: String,
) -> Result<(), String> {
	validate_allowed_root(&app_handle, &workspace_path)?;

	if doc_id.is_empty() || doc_id.len() > 512 {
		return Err("Invalid document ID.".to_string());
	}

	let bytes = BASE64_STANDARD
		.decode(&state)
		.map_err(|e| format!("Invalid base64 Yjs update: {}", e))?;

	if bytes.len() > MAX_YJS_DOC_SIZE {
		return Err(format!(
			"Yjs document state too large ({} bytes). Maximum allowed is {} bytes.",
			bytes.len(),
			MAX_YJS_DOC_SIZE
		));
	}

	let db = WorkspaceDb::open_existing(&workspace_path)?;
	let ws_id = get_workspace_id(&db)?;
	let now = Utc::now().to_rfc3339();

	db.conn
		.execute(
			"INSERT OR REPLACE INTO yjs_documents (workspace_id, doc_id, binary_state, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
			rusqlite::params![&ws_id, &doc_id, &bytes, &now],
		)
		.map_err(|e| format!("Failed to save Yjs document: {}", e))?;

	Ok(())
}

/// Moves a document's binary CRDT state to a new doc id, so a file rename doesn't strand its
/// live collaboration state under the old path. A no-op if nothing was stored under `old_doc_id`;
/// replaces any state already stored under `new_doc_id` (renaming onto an existing file's id).
#[tauri::command]
pub fn rename_yjs_doc(
	app_handle: tauri::AppHandle,
	workspace_path: String,
	old_doc_id: String,
	new_doc_id: String,
) -> Result<(), String> {
	validate_allowed_root(&app_handle, &workspace_path)?;

	if new_doc_id.is_empty() || new_doc_id.len() > 512 {
		return Err("Invalid document ID.".to_string());
	}

	let mut db = WorkspaceDb::open_existing(&workspace_path)?;
	let ws_id = get_workspace_id(&db)?;

	let tx = db.conn.transaction().map_err(|e| e.to_string())?;
	tx.execute(
		"DELETE FROM yjs_documents WHERE workspace_id = ?1 AND doc_id = ?2",
		rusqlite::params![&ws_id, &new_doc_id],
	)
	.map_err(|e| format!("Failed to rename Yjs document: {}", e))?;
	tx.execute(
		"UPDATE yjs_documents SET doc_id = ?1 WHERE workspace_id = ?2 AND doc_id = ?3",
		rusqlite::params![&new_doc_id, &ws_id, &old_doc_id],
	)
	.map_err(|e| format!("Failed to rename Yjs document: {}", e))?;
	tx.commit().map_err(|e| e.to_string())?;

	Ok(())
}

/// Deletes a document's binary CRDT state from SQLite
#[tauri::command]
pub fn delete_yjs_doc(
	app_handle: tauri::AppHandle,
	workspace_path: String,
	doc_id: String,
) -> Result<(), String> {
	validate_allowed_root(&app_handle, &workspace_path)?;

	let db = WorkspaceDb::open_existing(&workspace_path)?;
	let ws_id = get_workspace_id(&db)?;

	db.conn
		.execute(
			"DELETE FROM yjs_documents WHERE workspace_id = ?1 AND doc_id = ?2",
			rusqlite::params![&ws_id, &doc_id],
		)
		.map_err(|e| format!("Failed to delete Yjs document: {}", e))?;

	Ok(())
}
