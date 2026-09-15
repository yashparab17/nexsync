//! Yjs CRDT binary document persistence commands for SQLite.

use base64::prelude::*;
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::commands::config::validate_allowed_root;
use crate::database::WorkspaceDb;
use super::helpers::get_workspace_id;

/// Maximum allowed binary state snapshot size (25 MB)
const MAX_YJS_DOC_SIZE: usize = 25 * 1024 * 1024;

/// Summary metadata for a persisted Yjs document snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YjsDocSummary {
	pub doc_id: String,
	pub updated_at: String,
	pub size_bytes: usize,
}

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

/// Lists all Yjs document snapshots stored in the workspace database
#[tauri::command]
pub fn list_yjs_docs(
	app_handle: tauri::AppHandle,
	workspace_path: String,
) -> Result<Vec<YjsDocSummary>, String> {
	validate_allowed_root(&app_handle, &workspace_path)?;

	let db = WorkspaceDb::open_existing(&workspace_path)?;
	let ws_id = get_workspace_id(&db)?;

	let mut stmt = db
		.conn
		.prepare(
			"SELECT doc_id, updated_at, length(binary_state)
             FROM yjs_documents
             WHERE workspace_id = ?1
             ORDER BY updated_at DESC",
		)
		.map_err(|e| e.to_string())?;

	let docs = stmt
		.query_map([&ws_id], |r| {
			Ok(YjsDocSummary {
				doc_id: r.get(0)?,
				updated_at: r.get(1)?,
				size_bytes: r.get::<_, i64>(2)? as usize,
			})
		})
		.map_err(|e| e.to_string())?
		.filter_map(|r| r.ok())
		.collect();

	Ok(docs)
}
