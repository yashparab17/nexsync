//! Live file sync: watches the shared workspace and mirrors file changes with peers.
//!
//! Local changes are announced as `FILE_CHANGED` (path, size, content hash) or
//! `FILE_DELETED`. A peer fetches a changed file only when its own copy differs,
//! so an update settles after one round instead of echoing back and forth. The
//! host re-announces what it receives, which carries guest changes to other
//! guests. Deletions move files into `.nexsync/trash/` rather than removing them.

use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use super::{files, node::Node};
use crate::commands::path_utils::resolve_workspace_path;

pub const EVENT_FILES_CHANGED: &str = "p2p://files-changed";
pub const EVENT_REMOTE_FILE: &str = "p2p://remote-file";

/// Files above this size are announced but only downloaded on demand
pub const LAZY_FILE_BYTES: u64 = 10 * 1024 * 1024;
const DEBOUNCE: Duration = Duration::from_millis(400);

/// File sync messages exchanged on the control stream; handled in Rust, never shown to the UI
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum SyncMessage {
    #[serde(rename = "FILE_CHANGED", rename_all = "camelCase")]
    Changed {
        rel_path: String,
        size: u64,
        hash: Option<String>,
    },
    #[serde(rename = "FILE_DELETED", rename_all = "camelCase")]
    Deleted { rel_path: String },
}

impl SyncMessage {
    /// True if a JSON message on the control stream belongs to file sync
    pub fn is_sync_kind(kind: &str) -> bool {
        kind == "FILE_CHANGED" || kind == "FILE_DELETED"
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilesChanged<'a> {
    rel_path: &'a str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteFile<'a> {
    peer_id: &'a str,
    rel_path: &'a str,
    size: u64,
}

/// Watcher handle plus bookkeeping for in-flight downloads
pub struct LiveSync {
    watcher: Mutex<Option<RecommendedWatcher>>,
    local_changes: mpsc::UnboundedSender<PathBuf>,
    // Paths being downloaded; `true` means another change arrived meanwhile
    inflight: Mutex<HashMap<String, bool>>,
}

impl LiveSync {
    pub fn new() -> (Self, mpsc::UnboundedReceiver<PathBuf>) {
        let (local_changes, rx) = mpsc::unbounded_channel();
        let sync = Self {
            watcher: Mutex::new(None),
            local_changes,
            inflight: Mutex::new(HashMap::new()),
        };
        (sync, rx)
    }

    /// Starts watching `path` (replacing any previous watch), or stops watching when `None`
    pub fn watch(&self, path: Option<&str>) {
        let mut guard = self.watcher.lock().unwrap_or_else(|p| p.into_inner());
        *guard = None;
        let Some(path) = path else { return };

        let tx = self.local_changes.clone();
        let handler = move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                if matches!(event.kind, EventKind::Access(_)) {
                    return;
                }
                for p in event.paths {
                    let _ = tx.send(p);
                }
            }
        };
        let mut watcher = match notify::recommended_watcher(handler) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[P2P] Could not start the file watcher: {e}");
                return;
            }
        };
        if let Err(e) = watcher.watch(Path::new(path), RecursiveMode::Recursive) {
            eprintln!("[P2P] Could not watch {path}: {e}");
            return;
        }
        *guard = Some(watcher);
    }
}

/// Converts a watched absolute path into a syncable workspace-relative path
fn rel_path_of(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for component in rel.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_str()?),
            _ => return None,
        }
    }
    files::check_rel_path(&parts.join("/")).ok()
}

async fn hash_file(path: &Path, size: u64) -> Option<String> {
    if size > LAZY_FILE_BYTES {
        return None;
    }
    let bytes = tokio::fs::read(path).await.ok()?;
    Some(blake3::hash(&bytes).to_hex().to_string())
}

/// Describes the current state of a changed local path, or `None` if it isn't a syncable file
async fn describe_local(path: &Path, rel_path: String) -> Option<SyncMessage> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(meta) if meta.is_file() => Some(SyncMessage::Changed {
            hash: hash_file(path, meta.len()).await,
            size: meta.len(),
            rel_path,
        }),
        // Folders sync implicitly through the files inside them; symlinks are never synced
        Ok(_) => None,
        Err(_) => Some(SyncMessage::Deleted { rel_path }),
    }
}

/// Batches watcher events and announces local file changes to every peer
pub async fn run_local_changes(node: Arc<Node>, mut rx: mpsc::UnboundedReceiver<PathBuf>) {
    while let Some(first) = rx.recv().await {
        let mut batch = HashSet::from([first]);
        let deadline = tokio::time::sleep(DEBOUNCE);
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                _ = &mut deadline => break,
                next = rx.recv() => match next {
                    Some(path) => { batch.insert(path); }
                    None => return,
                },
            }
        }

        if !node.has_peers() {
            continue;
        }
        let Some(workspace) = node.workspace_path() else { continue };
        let root = PathBuf::from(&workspace);
        for path in batch {
            let Some(rel_path) = rel_path_of(&root, &path) else { continue };
            if let Some(message) = describe_local(&path, rel_path).await {
                if let Ok(value) = serde_json::to_value(&message) {
                    let _ = node.send(None, &value).await;
                }
            }
        }
    }
}

/// True if the local file already has the announced content
async fn already_matches(local: &Path, size: u64, hash: Option<&str>) -> bool {
    let Ok(meta) = tokio::fs::metadata(local).await else { return false };
    if !meta.is_file() || meta.len() != size {
        return false;
    }
    match hash {
        Some(expected) => hash_file(local, size).await.as_deref() == Some(expected),
        // Large files aren't hashed; same size is treated as unchanged
        None => true,
    }
}

/// Applies a file change or deletion announced by a peer to the shared workspace
pub async fn handle_remote(node: Arc<Node>, peer_id: String, message: SyncMessage) {
    if !node.peer_may_write(&peer_id) {
        return;
    }
    let Some(workspace) = node.workspace_path() else { return };

    match message {
        SyncMessage::Changed { rel_path, size, hash } => {
            let Ok(rel) = files::check_rel_path(&rel_path) else { return };
            let Ok(local) = resolve_workspace_path(&workspace, &rel) else { return };
            if already_matches(&local, size, hash.as_deref()).await {
                return;
            }
            if size > LAZY_FILE_BYTES {
                node.emit(EVENT_REMOTE_FILE, RemoteFile { peer_id: &peer_id, rel_path: &rel, size });
                return;
            }
            fetch_coalesced(&node, &peer_id, &workspace, rel).await;
        }
        SyncMessage::Deleted { rel_path } => {
            let Ok(rel) = files::check_rel_path(&rel_path) else { return };
            let Ok(local) = resolve_workspace_path(&workspace, &rel) else { return };
            if tokio::fs::symlink_metadata(&local).await.is_err() {
                return;
            }
            match move_to_trash(&workspace, &local, &rel).await {
                Ok(()) => node.emit(EVENT_FILES_CHANGED, FilesChanged { rel_path: &rel }),
                Err(e) => eprintln!("[P2P] Could not apply deletion of {rel}: {e}"),
            }
        }
    }
}

/// Downloads a file, re-downloading once more if it changed again while in flight
async fn fetch_coalesced(node: &Arc<Node>, peer_id: &str, workspace: &str, rel: String) {
    {
        let mut inflight = node.sync().inflight.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(dirty) = inflight.get_mut(&rel) {
            *dirty = true;
            return;
        }
        inflight.insert(rel.clone(), false);
    }

    loop {
        match files::fetch(node, peer_id, workspace, &rel).await {
            Ok(_) => node.emit(EVENT_FILES_CHANGED, FilesChanged { rel_path: &rel }),
            Err(e) => eprintln!("[P2P] Could not sync {rel}: {e}"),
        }
        let again = {
            let mut inflight = node.sync().inflight.lock().unwrap_or_else(|p| p.into_inner());
            if inflight.get(&rel).copied() == Some(true) {
                inflight.insert(rel.clone(), false);
                true
            } else {
                inflight.remove(&rel);
                false
            }
        };
        if !again {
            break;
        }
    }
}

/// Moves a deleted file or folder into `.nexsync/trash/<timestamp>/` so it can be recovered
async fn move_to_trash(workspace: &str, local: &Path, rel: &str) -> std::io::Result<()> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut dest = PathBuf::from(workspace)
        .join(".nexsync")
        .join("trash")
        .join(stamp.to_string());
    for part in rel.split('/') {
        dest.push(part);
    }
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::rename(local, dest).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sync_message_json_shape() {
        let msg = SyncMessage::Changed { rel_path: "notes/a.md".into(), size: 3, hash: Some("ab".into()) };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["kind"], "FILE_CHANGED");
        assert_eq!(json["relPath"], "notes/a.md");
        assert_eq!(serde_json::from_value::<SyncMessage>(json).unwrap(), msg);
        let del = serde_json::to_value(SyncMessage::Deleted { rel_path: "files/x".into() }).unwrap();
        assert_eq!(del["kind"], "FILE_DELETED");
    }

    #[test]
    fn test_rel_path_of_filters_unsyncable_paths() {
        let root = PathBuf::from("/ws");
        assert_eq!(rel_path_of(&root, &root.join("notes").join("a.md")).as_deref(), Some("notes/a.md"));
        assert_eq!(rel_path_of(&root, &root.join("notes").join("sub").join("b.md")).as_deref(), Some("notes/sub/b.md"));
        assert_eq!(rel_path_of(&root, &root.join("notes").join(".a.md.nexsync-part")), None);
        assert_eq!(rel_path_of(&root, &root.join(".nexsync").join("nexsync.db")), None);
        assert_eq!(rel_path_of(&root, &root.join("tasks").join("x")), None);
        assert_eq!(rel_path_of(&root, &root.join("notes")), None);
        assert_eq!(rel_path_of(&root, Path::new("/elsewhere/notes/a.md")), None);
    }
}
