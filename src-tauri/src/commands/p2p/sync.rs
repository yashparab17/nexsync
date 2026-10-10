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
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, watch};

use super::{files, node::Node};
use crate::commands::path_utils::resolve_workspace_path;
use crate::commands::workspace::data_sync::{self, DataState};

pub const EVENT_FILES_CHANGED: &str = "p2p://files-changed";
pub const EVENT_REMOTE_FILE: &str = "p2p://remote-file";
pub const EVENT_DATA_CHANGED: &str = "p2p://data-changed";

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
    /// Every syncable file this peer has, sent on connect so both sides can catch up
    #[serde(rename = "FILE_MANIFEST")]
    Manifest { files: Vec<ManifestEntry> },
    /// This peer's tasks and kanban, sent on connect and merged by the receiver
    #[serde(rename = "DATA_SYNC")]
    Data { state: DataState },
}

/// One file in a [`SyncMessage::Manifest`]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub rel_path: String,
    pub size: u64,
    pub hash: Option<String>,
    /// Last modified time in milliseconds since the Unix epoch
    pub modified: u64,
    /// True if the sender changed the file after its last sync with anyone
    pub dirty: bool,
}

impl SyncMessage {
    /// True if a JSON message on the control stream belongs to file sync
    pub fn is_sync_kind(kind: &str) -> bool {
        matches!(kind, "FILE_CHANGED" | "FILE_DELETED" | "FILE_MANIFEST" | "DATA_SYNC")
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
    /// Downloads in progress by (peer, path), each with the switch that cancels it
    transfers: Mutex<HashMap<(String, String), watch::Sender<bool>>>,
    /// Bumped when the user cancels everything, so catch-up loops stop starting new downloads
    generation: AtomicU64,
}

impl LiveSync {
    pub fn new() -> (Self, mpsc::UnboundedReceiver<PathBuf>) {
        let (local_changes, rx) = mpsc::unbounded_channel();
        let sync = Self {
            watcher: Mutex::new(None),
            local_changes,
            inflight: Mutex::new(HashMap::new()),
            transfers: Mutex::new(HashMap::new()),
            generation: AtomicU64::new(0),
        };
        (sync, rx)
    }

    /// Registers a download and returns the receiver that turns `true` when it is cancelled
    pub fn start_transfer(&self, peer_id: &str, rel_path: &str) -> watch::Receiver<bool> {
        let (tx, rx) = watch::channel(false);
        self.transfers.lock().unwrap_or_else(|p| p.into_inner()).insert((peer_id.into(), rel_path.into()), tx);
        rx
    }

    pub fn end_transfer(&self, peer_id: &str, rel_path: &str) {
        self.transfers.lock().unwrap_or_else(|p| p.into_inner()).remove(&(peer_id.to_string(), rel_path.to_string()));
    }

    /// Cancels the downloads of `rel_path`, or every download when `None`; returns how many were running
    pub fn cancel_transfers(&self, rel_path: Option<&str>) -> usize {
        if rel_path.is_none() {
            self.generation.fetch_add(1, Ordering::SeqCst);
        }
        let transfers = self.transfers.lock().unwrap_or_else(|p| p.into_inner());
        let mut cancelled = 0;
        for ((_, rel), tx) in transfers.iter() {
            if rel_path.is_none_or(|r| r == rel) && tx.send(true).is_ok() {
                cancelled += 1;
            }
        }
        cancelled
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
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
        SyncMessage::Manifest { files } => handle_manifest(&node, &peer_id, &workspace, files).await,
        SyncMessage::Data { state } => handle_data(&node, &peer_id, &workspace, state).await,
    }
}

// ────────────────────────────
// Catch-up on connect
// ────────────────────────────

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn modified_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn last_sync_path(workspace: &str) -> PathBuf {
    Path::new(workspace).join(".nexsync").join("last_sync")
}

/// When this device last finished syncing with a peer; 0 if it never has.
fn read_last_sync(workspace: &str) -> u64 {
    std::fs::read_to_string(last_sync_path(workspace)).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0)
}

/// Records that everything up to now was in sync, so later edits count as offline changes.
pub fn mark_synced(workspace: &str) {
    let _ = std::fs::write(last_sync_path(workspace), now_ms().to_string());
}

/// Sends this device's tasks/kanban and file list to a newly connected peer.
pub async fn send_catch_up(node: Arc<Node>, peer_id: String) {
    let Some(workspace) = node.workspace_path() else { return };

    let ws = workspace.clone();
    if let Ok(Ok(state)) = tokio::task::spawn_blocking(move || data_sync::export_for(&ws)).await {
        if let Ok(value) = serde_json::to_value(SyncMessage::Data { state }) {
            let _ = node.send(Some(&peer_id), &value).await;
        }
    }
    let files = build_manifest(&workspace).await;
    if let Ok(value) = serde_json::to_value(SyncMessage::Manifest { files }) {
        let _ = node.send(Some(&peer_id), &value).await;
    }
}

async fn build_manifest(workspace: &str) -> Vec<ManifestEntry> {
    let last_sync = read_last_sync(workspace);
    let ws = workspace.to_string();
    let listed = tokio::task::spawn_blocking(move || files::list_shareable_files(&ws))
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();
    let mut out = Vec::with_capacity(listed.len());
    for f in listed {
        let Ok(path) = resolve_workspace_path(workspace, &f.rel_path) else { continue };
        let Ok(meta) = tokio::fs::metadata(&path).await else { continue };
        let modified = modified_ms(&meta);
        // ponytail: hashes every small file on each connect, add a (path, size, mtime) cache if that gets slow.
        out.push(ManifestEntry {
            hash: hash_file(&path, f.size).await,
            size: f.size,
            modified,
            dirty: modified > last_sync,
            rel_path: f.rel_path,
        });
    }
    out
}

/// Downloads a file, or offers it as a placeholder when it is too large to fetch eagerly.
async fn pull(node: &Arc<Node>, peer_id: &str, workspace: &str, rel: String, size: u64) {
    if size > LAZY_FILE_BYTES {
        node.emit(EVENT_REMOTE_FILE, RemoteFile { peer_id, rel_path: &rel, size });
        return;
    }
    fetch_coalesced(node, peer_id, workspace, rel).await;
}

/// Brings this device up to date with a peer's file list without ever losing an edit.
async fn handle_manifest(node: &Arc<Node>, peer_id: &str, workspace: &str, entries: Vec<ManifestEntry>) {
    let last_sync = read_last_sync(workspace);
    let generation = node.sync().generation();
    // A copy of a file that was erased here is not brought back, unless it was written after the erasure
    let erased = {
        let ws = workspace.to_string();
        tokio::task::spawn_blocking(move || crate::commands::workspace::erase::erased_list(&ws)).await.unwrap_or_default()
    };
    for entry in entries {
        // The user cancelled the transfers, so don't start the rest of this catch-up.
        if node.sync().generation() != generation {
            break;
        }
        let Ok(rel) = files::check_rel_path(&entry.rel_path) else { continue };
        if crate::commands::workspace::erase::covers(&erased, &rel, entry.modified) {
            continue;
        }
        let Ok(local) = resolve_workspace_path(workspace, &rel) else { continue };
        let meta = tokio::fs::metadata(&local).await.ok().filter(|m| m.is_file());
        if let Some(meta) = meta {
            if already_matches(&local, entry.size, entry.hash.as_deref()).await {
                continue;
            }
            let local_modified = modified_ms(&meta);
            if local_modified > last_sync {
                // Edited here while apart: keep it unless the peer also edited and is newer, in
                // which case both versions survive. Otherwise the peer pulls ours from its side.
                if !entry.dirty || entry.modified <= local_modified {
                    continue;
                }
                if let Err(e) = keep_conflict_copy(&local).await {
                    eprintln!("[P2P] Could not keep a copy of {rel}, skipping it: {e}");
                    continue;
                }
            } else if let Err(e) = copy_to_trash(workspace, &local, &rel).await {
                eprintln!("[P2P] Could not back up {rel} before updating it, skipping: {e}");
                continue;
            }
        }
        pull(node, peer_id, workspace, rel, entry.size).await;
    }
}

/// Saves the current file next to itself as `name.conflict-<time>.ext`.
async fn keep_conflict_copy(local: &Path) -> std::io::Result<()> {
    let stem = local.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = local.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let copy = local.with_file_name(format!("{stem}.conflict-{}{ext}", now_ms()));
    tokio::fs::copy(local, copy).await.map(|_| ())
}

/// Backs up a file into the trash before a sync replaces it.
async fn copy_to_trash(workspace: &str, local: &Path, rel: &str) -> std::io::Result<()> {
    let (workspace, local, rel) = (workspace.to_string(), local.to_path_buf(), rel.to_string());
    tokio::task::spawn_blocking(move || crate::commands::workspace::trash::copy_to_trash(&workspace, &local, &rel))
        .await
        .map_err(std::io::Error::other)?
}

/// Merges a peer's tasks and kanban; a host also passes what it learned on to its other guests.
async fn handle_data(node: &Arc<Node>, peer_id: &str, workspace: &str, state: DataState) {
    let ws = workspace.to_string();
    let changed = match tokio::task::spawn_blocking(move || data_sync::merge_into(&ws, state)).await {
        Ok(Ok(changed)) => changed,
        Ok(Err(e)) => return eprintln!("[P2P] Could not merge a peer's tasks and kanban: {e}"),
        Err(_) => return,
    };
    if !changed {
        return;
    }
    node.emit(EVENT_DATA_CHANGED, serde_json::json!({}));

    let others: Vec<String> = node.peers().into_iter().filter(|p| p.id != peer_id).map(|p| p.id).collect();
    if others.is_empty() || !node.peer_is_host(peer_id).is_some_and(|is_host| !is_host) {
        return;
    }
    let ws = workspace.to_string();
    if let Ok(Ok(merged)) = tokio::task::spawn_blocking(move || data_sync::export_for(&ws)).await {
        if let Ok(value) = serde_json::to_value(SyncMessage::Data { state: merged }) {
            for id in others {
                let _ = node.send(Some(&id), &value).await;
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

/// Moves a deleted file or folder into the workspace trash so it can be recovered
async fn move_to_trash(workspace: &str, local: &Path, rel: &str) -> std::io::Result<()> {
    let (workspace, local, rel) = (workspace.to_string(), local.to_path_buf(), rel.to_string());
    tokio::task::spawn_blocking(move || crate::commands::workspace::trash::move_to_trash(&workspace, &local, &rel))
        .await
        .map_err(std::io::Error::other)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cancelling_transfers_reaches_only_the_matching_downloads() {
        let (sync, _rx) = LiveSync::new();
        let a = sync.start_transfer("peer", "files/a.bin");
        let b = sync.start_transfer("peer", "files/b.bin");
        assert_eq!(sync.cancel_transfers(Some("files/a.bin")), 1);
        assert!(*a.borrow() && !*b.borrow());
        assert_eq!(sync.generation(), 0, "cancelling one file must not stop the catch-up");

        assert_eq!(sync.cancel_transfers(None), 2);
        assert!(*b.borrow());
        assert_eq!(sync.generation(), 1);

        sync.end_transfer("peer", "files/a.bin");
        sync.end_transfer("peer", "files/b.bin");
        assert_eq!(sync.cancel_transfers(None), 0);
    }

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
