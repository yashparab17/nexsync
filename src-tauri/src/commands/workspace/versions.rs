//! Local version history. Every save, sync and import of a file keeps a copy, so an earlier state can be
//! compared or restored. Contents live in `.nexsync/versions/<blake3 hash>` (identical content is stored once)
//! and the database lists which versions belong to which path. History belongs to this device and is not synced.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use super::helpers::get_workspace_id;
use crate::commands::config::validate_allowed_root;
use crate::commands::path_utils::resolve_workspace_path;
use crate::database::WorkspaceDb;

/// Larger files are not versioned, matching the largest attachment the app handles
const MAX_VERSION_BYTES: u64 = 50 * 1024 * 1024;

/// Versions kept per file besides the ones the person named
const KEEP_UNNAMED: i64 = 100;

/// Largest version that can be read back as text
const MAX_TEXT_BYTES: u64 = 10 * 1024 * 1024;

/// One saved state of a file
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub id: i64,
    pub path: String,
    pub hash: String,
    pub size: u64,
    /// Where it came from: save, sync, import, auto, named, restore or before-restore
    pub source: String,
    pub label: Option<String>,
    pub created_at: String,
}

fn blob_dir(workspace: &str) -> PathBuf {
    Path::new(workspace).join(".nexsync").join("versions")
}

/// Hidden files and the app's own folder are never versioned
fn versionable(rel: &str) -> bool {
    !rel.is_empty() && !rel.split('/').any(|part| part.starts_with('.'))
}

/// Keeps the newest `keep` unnamed versions of a path, and every named one, and removes contents nothing uses
fn prune(db: &WorkspaceDb, workspace: &str, ws_id: &str, rel: &str, keep: i64) -> Result<(), String> {
    let doomed: Vec<(i64, String)> = {
        let mut stmt = db
            .conn
            .prepare(
                "SELECT id, hash FROM file_versions WHERE workspace_id = ?1 AND path = ?2 AND label IS NULL
                 ORDER BY id DESC LIMIT -1 OFFSET ?3",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![ws_id, rel, keep], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.filter_map(Result::ok).collect()
    };
    for (id, hash) in doomed {
        db.conn.execute("DELETE FROM file_versions WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
        let still_used: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM file_versions WHERE hash = ?1", [&hash], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if still_used == 0 {
            let _ = fs::remove_file(blob_dir(workspace).join(&hash));
        }
    }
    Ok(())
}

fn record_with_limit(
    workspace: &str,
    rel: &str,
    bytes: &[u8],
    source: &str,
    label: Option<&str>,
    keep: i64,
) -> Result<Option<i64>, String> {
    let rel = rel.trim_matches('/');
    if !versionable(rel) || bytes.len() as u64 > MAX_VERSION_BYTES {
        return Ok(None);
    }
    let hash = blake3::hash(bytes).to_hex().to_string();
    let db = WorkspaceDb::open_existing(workspace)?;
    let ws_id = get_workspace_id(&db)?;

    // Saving the same content again is not a new version, but it can name the one already there
    let latest: Option<(i64, String)> = db
        .conn
        .query_row(
            "SELECT id, hash FROM file_versions WHERE workspace_id = ?1 AND path = ?2 ORDER BY id DESC LIMIT 1",
            params![ws_id, rel],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((id, latest_hash)) = latest {
        if latest_hash == hash {
            if let Some(label) = label {
                db.conn
                    .execute("UPDATE file_versions SET label = ?1 WHERE id = ?2", params![label, id])
                    .map_err(|e| e.to_string())?;
                return Ok(Some(id));
            }
            return Ok(None);
        }
    }

    let dir = blob_dir(workspace);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let blob = dir.join(&hash);
    if !blob.exists() {
        // Written aside and renamed, so a crash never leaves half a version under its real name
        let partial = dir.join(format!("{hash}.part"));
        fs::write(&partial, bytes).map_err(|e| e.to_string())?;
        fs::rename(&partial, &blob).map_err(|e| e.to_string())?;
    }
    db.conn
        .execute(
            "INSERT INTO file_versions (workspace_id, path, hash, size, source, label, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![ws_id, rel, hash, bytes.len() as i64, source, label, Utc::now().to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
    let id = db.conn.last_insert_rowid();
    prune(&db, workspace, &ws_id, rel, keep)?;
    Ok(Some(id))
}

/// Keeps `bytes` as the newest version of `rel`, unless it is what the latest version already holds
pub fn record_bytes(workspace: &str, rel: &str, bytes: &[u8], source: &str, label: Option<&str>) -> Result<Option<i64>, String> {
    record_with_limit(workspace, rel, bytes, source, label, KEEP_UNNAMED)
}

/// Keeps the file at `file` as the newest version of `rel`
pub fn record_file(workspace: &str, rel: &str, file: &Path, source: &str) -> Result<Option<i64>, String> {
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    if len > MAX_VERSION_BYTES {
        return Ok(None);
    }
    let bytes = fs::read(file).map_err(|e| e.to_string())?;
    record_bytes(workspace, rel, &bytes, source, None)
}

/// Moves the history of a renamed file, or of every file inside a renamed folder
pub fn rename_path(workspace: &str, old_rel: &str, new_rel: &str) -> Result<(), String> {
    let (old, new) = (old_rel.trim_matches('/'), new_rel.trim_matches('/'));
    let db = WorkspaceDb::open_existing(workspace)?;
    let ws_id = get_workspace_id(&db)?;
    db.conn
        .execute(
            "UPDATE file_versions SET path = ?3 || substr(path, length(?2) + 1)
             WHERE workspace_id = ?1 AND (path = ?2 OR substr(path, 1, length(?2) + 1) = ?2 || '/')",
            params![ws_id, old, new],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn version_row(db: &WorkspaceDb, ws_id: &str, id: i64) -> Result<FileVersion, String> {
    db.conn
        .query_row(
            "SELECT id, path, hash, size, source, label, created_at FROM file_versions WHERE workspace_id = ?1 AND id = ?2",
            params![ws_id, id],
            |r| {
                Ok(FileVersion {
                    id: r.get(0)?,
                    path: r.get(1)?,
                    hash: r.get(2)?,
                    size: r.get::<_, i64>(3)? as u64,
                    source: r.get(4)?,
                    label: r.get(5)?,
                    created_at: r.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "That version no longer exists.".to_string())
}

/// The versions of a file, newest first
pub fn list(workspace: &str, rel: &str) -> Result<Vec<FileVersion>, String> {
    let db = WorkspaceDb::open_existing(workspace)?;
    let ws_id = get_workspace_id(&db)?;
    let mut stmt = db
        .conn
        .prepare("SELECT id FROM file_versions WHERE workspace_id = ?1 AND path = ?2 ORDER BY id DESC")
        .map_err(|e| e.to_string())?;
    let ids: Vec<i64> = stmt
        .query_map(params![ws_id, rel.trim_matches('/')], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    ids.into_iter().map(|id| version_row(&db, &ws_id, id)).collect()
}

// ────────────────────────────
// Tauri commands — Version history
// ────────────────────────────

/// Lists the saved versions of a file, newest first
#[tauri::command]
pub fn list_file_versions(app_handle: tauri::AppHandle, path: String, rel_path: String) -> Result<Vec<FileVersion>, String> {
    validate_allowed_root(&app_handle, &path)?;
    list(&path, &rel_path)
}

/// Keeps the text an editor holds right now as a version: `auto` for the periodic snapshot, `named` for one
/// the person labelled
#[tauri::command]
pub fn record_file_version(
    app_handle: tauri::AppHandle,
    path: String,
    rel_path: String,
    content: String,
    source: Option<String>,
    label: Option<String>,
) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    resolve_workspace_path(&path, rel_path.trim_matches('/'))?;
    let source = source.unwrap_or_else(|| "auto".to_string());
    let label = label.map(|l| l.trim().chars().take(80).collect::<String>()).filter(|l| !l.is_empty());
    match (source.as_str(), &label) {
        ("auto", None) => {}
        ("named", Some(_)) => {}
        _ => return Err("A named version needs a name, and a snapshot cannot have one.".to_string()),
    }
    record_bytes(&path, &rel_path, content.as_bytes(), &source, label.as_deref())?;
    Ok(())
}

/// Reads a version as text, for the preview and the diff
#[tauri::command]
pub fn read_file_version(app_handle: tauri::AppHandle, path: String, id: i64) -> Result<String, String> {
    validate_allowed_root(&app_handle, &path)?;
    let db = WorkspaceDb::open_existing(&path)?;
    let ws_id = get_workspace_id(&db)?;
    let version = version_row(&db, &ws_id, id)?;
    if version.size > MAX_TEXT_BYTES {
        return Err("This version is too large to show.".to_string());
    }
    let bytes = fs::read(blob_dir(&path).join(&version.hash)).map_err(|_| "The saved copy is missing.".to_string())?;
    String::from_utf8(bytes).map_err(|_| "This version is not text.".to_string())
}

/// Puts a version back on disk. What was there is kept as a version first, so a restore can be undone.
/// Text files that are open in an editor are restored from the editor instead, so collaborators see it.
#[tauri::command]
pub fn restore_file_version(app_handle: tauri::AppHandle, path: String, id: i64) -> Result<String, String> {
    validate_allowed_root(&app_handle, &path)?;
    let db = WorkspaceDb::open_existing(&path)?;
    let ws_id = get_workspace_id(&db)?;
    let version = version_row(&db, &ws_id, id)?;
    drop(db);

    let target = resolve_workspace_path(&path, &version.path)?;
    if target.is_file() {
        let _ = record_file(&path, &version.path, &target, "before-restore");
    }
    let bytes = fs::read(blob_dir(&path).join(&version.hash)).map_err(|_| "The saved copy is missing.".to_string())?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&target, &bytes).map_err(|e| e.to_string())?;
    let _ = record_bytes(&path, &version.path, &bytes, "restore", None);
    Ok(version.path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn workspace() -> (String, PathBuf) {
        let dir = std::env::temp_dir().join(format!("nexsync-versions-{}", Uuid::new_v4()));
        let path = dir.to_string_lossy().to_string();
        let db = WorkspaceDb::open(&path).unwrap();
        db.conn
            .execute(
                "INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES ('ws-1', 'W', '', ?1, 'x', 'x')",
                [&path],
            )
            .unwrap();
        (path, dir)
    }

    fn blobs(dir: &Path) -> usize {
        fs::read_dir(dir.join(".nexsync").join("versions")).map(|d| d.count()).unwrap_or(0)
    }

    #[test]
    fn identical_content_is_one_version_and_can_be_named() {
        let (ws, dir) = workspace();
        assert!(record_bytes(&ws, "notes/a.md", b"one", "save", None).unwrap().is_some());
        assert!(record_bytes(&ws, "notes/a.md", b"one", "save", None).unwrap().is_none());
        assert!(record_bytes(&ws, "notes/a.md", b"one", "named", Some("Draft 1")).unwrap().is_some());
        record_bytes(&ws, "notes/a.md", b"two", "save", None).unwrap();
        let versions = list(&ws, "notes/a.md").unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[1].label.as_deref(), Some("Draft 1"));
        assert_eq!(versions[0].size, 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn old_unnamed_versions_are_pruned_and_unused_contents_removed() {
        let (ws, dir) = workspace();
        record_with_limit(&ws, "a.txt", b"first", "save", Some("keep me"), 2).unwrap();
        for text in ["b", "c", "d", "e"] {
            record_with_limit(&ws, "a.txt", text.as_bytes(), "save", None, 2).unwrap();
        }
        // the named one plus the newest two
        assert_eq!(list(&ws, "a.txt").unwrap().len(), 3);
        assert_eq!(blobs(&dir), 3);

        // Content shared with another file survives when one of them lets it go
        record_with_limit(&ws, "other.txt", b"e", "save", None, 2).unwrap();
        for text in ["f", "g", "h"] {
            record_with_limit(&ws, "a.txt", text.as_bytes(), "save", None, 2).unwrap();
        }
        assert!(dir.join(".nexsync").join("versions").join(blake3::hash(b"e").to_hex().as_str()).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn renaming_moves_history_of_a_file_and_of_a_folder_but_not_lookalikes() {
        let (ws, dir) = workspace();
        record_bytes(&ws, "editor/src/app.py", b"x", "save", None).unwrap();
        record_bytes(&ws, "editor/src2/app.py", b"y", "save", None).unwrap();
        rename_path(&ws, "editor/src", "editor/lib").unwrap();
        assert_eq!(list(&ws, "editor/lib/app.py").unwrap().len(), 1);
        assert_eq!(list(&ws, "editor/src/app.py").unwrap().len(), 0);
        assert_eq!(list(&ws, "editor/src2/app.py").unwrap().len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hidden_and_internal_paths_are_not_versioned() {
        let (ws, dir) = workspace();
        assert!(record_bytes(&ws, ".nexsync/x", b"x", "save", None).unwrap().is_none());
        assert!(record_bytes(&ws, "editor/.env", b"x", "save", None).unwrap().is_none());
        assert!(record_bytes(&ws, "", b"x", "save", None).unwrap().is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
