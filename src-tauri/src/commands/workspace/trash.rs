//! Trash: deleted items live in `.nexsync/trash/<timestamp>/<original path>` until restored or purged.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::commands::config::validate_allowed_root;
use crate::commands::path_utils::resolve_workspace_path;

/// Marker file inside a trash entry that records the original relative path.
const ORIGIN_FILE: &str = ".origin";

/// One deleted item shown in the Trash view
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub id: String,
    pub rel_path: String,
    pub is_dir: bool,
    pub size: u64,
    pub deleted_at: u128,
}

fn trash_root(workspace: &str) -> PathBuf {
    Path::new(workspace).join(".nexsync").join("trash")
}

/// Entry ids are millisecond timestamps, so anything else is rejected before touching the disk.
fn entry_dir(workspace: &str, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Invalid trash item.".to_string());
    }
    let dir = trash_root(workspace).join(id);
    if dir.is_dir() { Ok(dir) } else { Err("Trash item not found.".to_string()) }
}

/// Trash entries older than this are deleted the next time something is trashed or the Trash is opened.
const RETENTION_MS: u128 = 30 * 24 * 60 * 60 * 1000;

/// Deletes entries older than `RETENTION_MS`. Ids are millisecond timestamps, so age needs no file reads.
fn purge_expired(workspace: &str, now: u128) {
    let Ok(rd) = fs::read_dir(trash_root(workspace)) else { return };
    for e in rd.flatten() {
        let Some(at) = e.file_name().to_string_lossy().parse::<u128>().ok() else { continue };
        if now.saturating_sub(at) > RETENTION_MS {
            let _ = fs::remove_dir_all(e.path());
        }
    }
}

/// Moves `local` (workspace-relative `rel`) into a fresh trash entry.
pub fn move_to_trash(workspace: &str, local: &Path, rel: &str) -> io::Result<()> {
    stash(workspace, local, rel, false)
}

/// Copies `local` into a fresh trash entry and leaves it in place, so a sync can overwrite it safely.
pub fn copy_to_trash(workspace: &str, local: &Path, rel: &str) -> io::Result<()> {
    stash(workspace, local, rel, true)
}

fn stash(workspace: &str, local: &Path, rel: &str, keep_original: bool) -> io::Result<()> {
    let mut stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    purge_expired(workspace, stamp);
    // Bump on collision so two deletions in the same millisecond stay separate entries.
    while trash_root(workspace).join(stamp.to_string()).exists() {
        stamp += 1;
    }
    let entry = trash_root(workspace).join(stamp.to_string());
    let mut dest = entry.clone();
    for part in rel.split('/') {
        dest.push(part);
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    if keep_original {
        fs::copy(local, &dest)?;
    } else {
        fs::rename(local, &dest)?;
    }
    fs::write(entry.join(ORIGIN_FILE), rel)
}

/// Deletes every trash entry that holds `rel` or something inside it; used when a file is erased for good. Returns how many.
pub fn erase_matching(workspace: &str, rel: &str) -> usize {
    let Ok(rd) = fs::read_dir(trash_root(workspace)) else { return 0 };
    let inside = format!("{rel}/");
    let mut gone = 0;
    for entry in rd.flatten() {
        let origin = origin_of(&entry.path());
        if (origin == rel || origin.starts_with(&inside)) && fs::remove_dir_all(entry.path()).is_ok() {
            gone += 1;
        }
    }
    gone
}

/// Total size of a file or directory tree.
fn tree_size(path: &Path) -> u64 {
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => fs::read_dir(path)
            .map(|rd| rd.flatten().map(|e| tree_size(&e.path())).sum())
            .unwrap_or(0),
        Ok(m) => m.len(),
        Err(_) => 0,
    }
}

/// Original path of an entry: the marker if present, otherwise the single-child chain (older entries).
fn origin_of(entry: &Path) -> String {
    if let Ok(rel) = fs::read_to_string(entry.join(ORIGIN_FILE)) {
        return rel;
    }
    let mut cur = entry.to_path_buf();
    let mut parts = vec![];
    loop {
        let children: Vec<_> = fs::read_dir(&cur).map(|rd| rd.flatten().collect()).unwrap_or_default();
        match children.as_slice() {
            [only] => {
                parts.push(only.file_name().to_string_lossy().to_string());
                cur = only.path();
                if !cur.is_dir() {
                    break;
                }
            }
            _ => break,
        }
    }
    parts.join("/")
}

/// Moves `src` to `dst`, merging into existing folders and refusing to overwrite files.
fn restore_into(src: &Path, dst: &Path) -> Result<(), String> {
    if src.is_dir() && dst.is_dir() {
        for child in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
            restore_into(&child.path(), &dst.join(child.file_name()))?;
        }
        return Ok(());
    }
    if dst.exists() {
        return Err(format!("{} already exists.", dst.file_name().unwrap_or_default().to_string_lossy()));
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(src, dst).map_err(|e| e.to_string())
}

// ────────────────────────────
// Tauri commands — Trash
// ────────────────────────────

/// Lists trashed items, newest first
#[tauri::command]
pub fn list_trash(app_handle: tauri::AppHandle, path: String) -> Result<Vec<TrashItem>, String> {
    validate_allowed_root(&app_handle, &path)?;
    purge_expired(&path, SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    let mut items: Vec<TrashItem> = fs::read_dir(trash_root(&path))
        .map(|rd| rd.flatten().collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|e| {
            let id = e.file_name().to_string_lossy().to_string();
            let deleted_at = id.parse().ok()?;
            let dir = e.path();
            let rel_path = origin_of(&dir);
            let content = rel_path.split('/').fold(dir.clone(), |p, s| p.join(s));
            Some(TrashItem { id, is_dir: content.is_dir(), size: tree_size(&content), rel_path, deleted_at })
        })
        .collect();
    items.sort_by_key(|i| std::cmp::Reverse(i.deleted_at));
    Ok(items)
}

/// Moves a trashed item back to its original location
#[tauri::command]
pub fn restore_trash_item(app_handle: tauri::AppHandle, path: String, id: String) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    let entry = entry_dir(&path, &id)?;
    let workspace = resolve_workspace_path(&path, "")?;
    // Validates that the original location is still inside the workspace roots.
    resolve_workspace_path(&path, &origin_of(&entry))?;
    for child in fs::read_dir(&entry).map_err(|e| e.to_string())?.flatten() {
        if child.file_name() == ORIGIN_FILE {
            continue;
        }
        restore_into(&child.path(), &workspace.join(child.file_name()))?;
    }
    fs::remove_dir_all(entry).map_err(|e| e.to_string())
}

/// Permanently deletes one trashed item
#[tauri::command]
pub fn purge_trash_item(app_handle: tauri::AppHandle, path: String, id: String) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    fs::remove_dir_all(entry_dir(&path, &id)?).map_err(|e| e.to_string())
}

/// Permanently deletes everything in the trash
#[tauri::command]
pub fn empty_trash(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    match fs::remove_dir_all(trash_root(&path)) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_ws(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nexsync-trash-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("notes")).unwrap();
        dir
    }

    fn only_entry(ws: &str) -> PathBuf {
        fs::read_dir(trash_root(ws)).unwrap().flatten().next().unwrap().path()
    }

    #[test]
    fn test_trash_and_restore_round_trip() {
        let ws = temp_ws("roundtrip");
        let ws_str = ws.to_string_lossy().to_string();
        let file = ws.join("notes").join("a.md");
        fs::write(&file, "hello").unwrap();

        move_to_trash(&ws_str, &file, "notes/a.md").unwrap();
        assert!(!file.exists());

        let entry = only_entry(&ws_str);
        assert_eq!(origin_of(&entry), "notes/a.md");

        restore_into(&entry.join("notes"), &ws.join("notes")).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "hello");
        let _ = fs::remove_dir_all(ws);
    }

    #[test]
    fn test_restore_refuses_to_overwrite() {
        let ws = temp_ws("conflict");
        let ws_str = ws.to_string_lossy().to_string();
        let file = ws.join("notes").join("a.md");
        fs::write(&file, "old").unwrap();
        move_to_trash(&ws_str, &file, "notes/a.md").unwrap();
        fs::write(&file, "new").unwrap();

        assert!(restore_into(&only_entry(&ws_str).join("notes"), &ws.join("notes")).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "new");
        let _ = fs::remove_dir_all(ws);
    }

    #[test]
    fn test_entry_id_must_be_numeric() {
        assert!(entry_dir("/ws", "../etc").is_err());
        assert!(entry_dir("/ws", "").is_err());
    }

    #[test]
    fn test_old_entries_are_purged_and_recent_ones_kept() {
        let ws = temp_ws("expiry");
        let ws_str = ws.to_string_lossy().to_string();
        let now: u128 = 100 * 24 * 60 * 60 * 1000;
        for age_days in [1u128, 29, 31, 90] {
            fs::create_dir_all(trash_root(&ws_str).join((now - age_days * 24 * 60 * 60 * 1000).to_string())).unwrap();
        }
        purge_expired(&ws_str, now);
        assert_eq!(fs::read_dir(trash_root(&ws_str)).unwrap().count(), 2);
        let _ = fs::remove_dir_all(ws);
    }

    #[test]
    fn test_same_millisecond_deletions_stay_separate() {
        let ws = temp_ws("collide");
        let ws_str = ws.to_string_lossy().to_string();
        for name in ["a.md", "b.md"] {
            let f = ws.join("notes").join(name);
            fs::write(&f, name).unwrap();
            move_to_trash(&ws_str, &f, &format!("notes/{name}")).unwrap();
        }
        assert_eq!(fs::read_dir(trash_root(&ws_str)).unwrap().count(), 2);
        let _ = fs::remove_dir_all(ws);
    }
}
