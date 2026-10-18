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
#[tauri::command(async)]
pub fn get_yjs_doc(
	app_handle: tauri::AppHandle,
	workspace_path: String,
	doc_id: String,
) -> Result<Option<String>, String> {
	validate_allowed_root(&app_handle, &workspace_path)?;

	if doc_id.is_empty() || doc_id.len() > 512 {
		return Err("Invalid document ID.".to_string());
	}

	Ok(load_doc(&workspace_path, &doc_id)?.map(|blob| BASE64_STANDARD.encode(&blob)))
}

fn load_doc(workspace_path: &str, doc_id: &str) -> Result<Option<Vec<u8>>, String> {
	let db = WorkspaceDb::open_existing(workspace_path)?;
	let ws_id = get_workspace_id(&db)?;
	let result: Result<Vec<u8>, rusqlite::Error> = db.conn.query_row(
		"SELECT binary_state FROM yjs_documents WHERE workspace_id = ?1 AND doc_id = ?2",
		rusqlite::params![&ws_id, &doc_id],
		|r| r.get(0),
	);
	match result {
		Ok(blob) => Ok(Some(blob)),
		Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
		Err(e) => Err(format!("Failed to retrieve Yjs document: {}", e)),
	}
}

fn store_doc(workspace_path: &str, doc_id: &str, bytes: &[u8]) -> Result<(), String> {
	if bytes.len() > MAX_YJS_DOC_SIZE {
		return Err(format!("Yjs document state too large ({} bytes). Maximum allowed is {} bytes.", bytes.len(), MAX_YJS_DOC_SIZE));
	}
	let db = WorkspaceDb::open_existing(workspace_path)?;
	let ws_id = get_workspace_id(&db)?;
	let now = Utc::now().to_rfc3339();
	db.conn
		.execute(
			"INSERT OR REPLACE INTO yjs_documents (workspace_id, doc_id, binary_state, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
			rusqlite::params![&ws_id, &doc_id, bytes, &now],
		)
		.map_err(|e| format!("Failed to save Yjs document: {}", e))?;
	Ok(())
}

/// [`get_yjs_doc`] as the bytes themselves: no base64 and no JSON on either side (a document's state runs to megabytes, and the
/// page would otherwise decode it a character at a time). Empty when nothing is stored.
#[tauri::command]
pub async fn get_yjs_doc_raw(app_handle: tauri::AppHandle, workspace_path: String, doc_id: String) -> Result<tauri::ipc::Response, String> {
	validate_allowed_root(&app_handle, &workspace_path)?;
	if doc_id.is_empty() || doc_id.len() > 512 {
		return Err("Invalid document ID.".to_string());
	}
	let bytes = tokio::task::spawn_blocking(move || load_doc(&workspace_path, &doc_id)).await.map_err(|e| e.to_string())??;
	Ok(tauri::ipc::Response::new(bytes.unwrap_or_default()))
}

/// [`save_yjs_doc`] with the state as the request's raw body, and the workspace and document in the `x-workspace` and `x-doc`
/// headers (percent-encoded, as headers carry only ASCII)
#[tauri::command]
pub async fn save_yjs_doc_raw(app_handle: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
	let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
		return Err("The document state must be sent as bytes.".to_string());
	};
	let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(percent_decode).ok_or_else(|| format!("Missing {k}."));
	let (workspace_path, doc_id) = (header("x-workspace")??, header("x-doc")??);
	validate_allowed_root(&app_handle, &workspace_path)?;
	if doc_id.is_empty() || doc_id.len() > 512 {
		return Err("Invalid document ID.".to_string());
	}
	let bytes = bytes.clone();
	tokio::task::spawn_blocking(move || store_doc(&workspace_path, &doc_id, &bytes)).await.map_err(|e| e.to_string())?
}

/// `%XX` escapes back to bytes, read as UTF-8
fn percent_decode(s: &str) -> Result<String, String> {
	let b = s.as_bytes();
	let mut out = Vec::with_capacity(b.len());
	let mut i = 0;
	while i < b.len() {
		if b[i] == b'%' && i + 2 < b.len() {
			let hex = std::str::from_utf8(&b[i + 1..i + 3]).map_err(|e| e.to_string())?;
			out.push(u8::from_str_radix(hex, 16).map_err(|e| e.to_string())?);
			i += 3;
		} else {
			out.push(b[i]);
			i += 1;
		}
	}
	String::from_utf8(out).map_err(|e| e.to_string())
}

/// Lists the ids of every document with stored CRDT state, so catch-up can cover closed notes
#[tauri::command(async)]
pub fn list_yjs_docs(app_handle: tauri::AppHandle, workspace_path: String) -> Result<Vec<String>, String> {
	validate_allowed_root(&app_handle, &workspace_path)?;

	let db = WorkspaceDb::open_existing(&workspace_path)?;
	let ws_id = get_workspace_id(&db)?;
	let mut stmt = db
		.conn
		.prepare("SELECT doc_id FROM yjs_documents WHERE workspace_id = ?1")
		.map_err(|e| e.to_string())?;
	let ids = stmt
		.query_map([&ws_id], |r| r.get(0))
		.map_err(|e| e.to_string())?
		.filter_map(|r| r.ok())
		.collect();
	Ok(ids)
}

/// Persists a document's binary CRDT state snapshot into SQLite
#[tauri::command(async)]
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
	store_doc(&workspace_path, &doc_id, &bytes)
}

/// Moves a document's binary CRDT state to a new doc id, so a file rename doesn't strand its
/// live collaboration state under the old path. A no-op if nothing was stored under `old_doc_id`;
/// replaces any state already stored under `new_doc_id` (renaming onto an existing file's id).
#[tauri::command(async)]
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
#[tauri::command(async)]
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
