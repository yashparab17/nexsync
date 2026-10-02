//! Streaming workspace files between peers over dedicated QUIC streams.
//!
//! Each transfer uses its own bi-directional stream: the requester sends the
//! relative path, the owner replies with the size and then the raw bytes.
//! Bytes go straight from disk to disk; QUIC provides encryption, integrity
//! and flow control, so there is no manual chunking or checksum step.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use iroh::endpoint::{RecvStream, SendStream};
use serde::Serialize;
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    sync::watch,
};

use super::{
    node::Node,
    wire::{self, FileReply, FileRequest},
};
use crate::commands::path_utils::resolve_workspace_path;

pub const EVENT_FILE_PROGRESS: &str = "p2p://file-progress";
/// A download ended, whether it finished, failed or was cancelled
pub const EVENT_FILE_ENDED: &str = "p2p://file-ended";

/// Workspace folders whose contents are shared with collaborators
const SYNC_ROOTS: &[&str] = &["notes", "files", "assets", "editor"];
const MAX_TRANSFER_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_MANIFEST_ENTRIES: usize = 20_000;
const MAX_DEPTH: usize = 32;
const REPLY_TIMEOUT: Duration = Duration::from_secs(30);
const STALL_TIMEOUT: Duration = Duration::from_secs(60);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
const BUFFER_SIZE: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareableFile {
    pub rel_path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileProgress<'a> {
    peer_id: &'a str,
    rel_path: &'a str,
    received_bytes: u64,
    total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEnded<'a> {
    peer_id: &'a str,
    rel_path: &'a str,
}

/// Keeps a download registered so it can be cancelled, and announces when it ends
struct TransferGuard {
    node: Arc<Node>,
    peer_id: String,
    rel_path: String,
}

impl TransferGuard {
    fn start(node: &Arc<Node>, peer_id: &str, rel_path: &str) -> (Self, watch::Receiver<bool>) {
        let cancel = node.sync().start_transfer(peer_id, rel_path);
        let guard = Self { node: node.clone(), peer_id: peer_id.into(), rel_path: rel_path.into() };
        (guard, cancel)
    }
}

impl Drop for TransferGuard {
    fn drop(&mut self) {
        self.node.sync().end_transfer(&self.peer_id, &self.rel_path);
        self.node.emit(EVENT_FILE_ENDED, FileEnded { peer_id: &self.peer_id, rel_path: &self.rel_path });
    }
}

/// Validates a peer-supplied path: must name a non-hidden file inside a synced folder
pub(super) fn check_rel_path(rel_path: &str) -> Result<String, String> {
    let trimmed = rel_path.trim().trim_start_matches('/');
    let invalid = || format!("Invalid file path: {rel_path}");

    let mut segments = trimmed.split('/');
    let root = segments.next().unwrap_or("");
    if !SYNC_ROOTS.contains(&root) {
        return Err(invalid());
    }
    let mut depth = 0;
    for segment in segments {
        if segment.is_empty()
            || segment.starts_with('.')
            || segment.contains('\\')
            || segment.contains(':')
        {
            return Err(invalid());
        }
        depth += 1;
    }
    if depth == 0 {
        return Err(invalid());
    }
    Ok(trimmed.to_string())
}

/// Recursively lists every shareable file in the workspace's synced folders
pub fn list_shareable_files(workspace_path: &str) -> Result<Vec<ShareableFile>, String> {
    let root = PathBuf::from(workspace_path)
        .canonicalize()
        .map_err(|e| format!("Failed to open workspace: {e}"))?;

    let mut files = Vec::new();
    for sub in SYNC_ROOTS {
        let dir = root.join(sub);
        if dir.is_dir() {
            walk(&dir, sub, 0, &mut files)?;
        }
    }
    files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(files)
}

fn walk(dir: &Path, rel: &str, depth: usize, out: &mut Vec<ShareableFile>) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Ok(());
    }
    let entries = std::fs::read_dir(dir).map_err(|e| format!("Failed to read {rel}: {e}"))?;
    for entry in entries.flatten() {
        // Skip hidden entries and names that can't be represented as UTF-8 paths
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let Ok(meta) = entry.path().symlink_metadata() else {
            continue;
        };
        if meta.is_symlink() {
            continue;
        }

        let child_rel = format!("{rel}/{name}");
        if meta.is_dir() {
            walk(&entry.path(), &child_rel, depth + 1, out)?;
        } else if meta.is_file() {
            if out.len() >= MAX_MANIFEST_ENTRIES {
                return Err(format!(
                    "This workspace has more than {MAX_MANIFEST_ENTRIES} files, which is too many to sync at once."
                ));
            }
            out.push(ShareableFile {
                rel_path: child_rel,
                size: meta.len(),
            });
        }
    }
    Ok(())
}

/// Downloads `rel_path` from a peer into the same path of the local workspace
pub async fn fetch(node: &Arc<Node>, peer_id: &str, workspace_path: &str, rel_path: &str) -> Result<u64, String> {
    let rel = check_rel_path(rel_path)?;
    let target = resolve_workspace_path(workspace_path, &rel)?;
    let conn = node.connection(peer_id)?;
    let (_transfer, mut cancel) = TransferGuard::start(node, peer_id, &rel);

    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create folder for {rel}: {e}"))?;
    }
    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| format!("Invalid file path: {rel}"))?;

    // An interrupted earlier attempt left bytes behind; ask the owner to continue after them.
    let partial = find_partial(&target, &file_name).await;
    let (offset, version) = partial.as_ref().map(|p| (p.len, p.version)).unwrap_or((0, 0));

    let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
    send.write_all(&[wire::STREAM_FILE]).await.map_err(|e| e.to_string())?;
    wire::write_json(&mut send, &FileRequest { rel_path: rel.clone(), offset, version }).await?;
    let _ = send.finish();

    let reply: FileReply = tokio::time::timeout(REPLY_TIMEOUT, wire::read_json(&mut recv, wire::MAX_SMALL_FRAME))
        .await
        .map_err(|_| "The collaborator didn't respond to the file request.".to_string())??;
    let (size, version, start) = match reply {
        FileReply::Ok { size, version, offset } => (size, version, offset),
        FileReply::Error { error } => {
            if let Some(p) = &partial {
                let _ = tokio::fs::remove_file(&p.path).await;
            }
            return Err(error);
        }
    };
    if size > MAX_TRANSFER_BYTES {
        let _ = recv.stop(0u32.into());
        return Err(format!("{rel} is too large to transfer ({size} bytes)."));
    }

    // Hidden temp file so a partial download never shows up in the file list
    let part = target.with_file_name(format!(".{file_name}.{version}.nexsync-part"));
    if start != 0 && partial.as_ref().map(|p| (p.path.as_path(), p.len)) != Some((part.as_path(), start)) {
        let _ = recv.stop(0u32.into());
        return Err("The collaborator resumed from an unexpected position.".into());
    }
    // Bytes from a different version of the file, or from a restart, are useless.
    if let Some(p) = &partial {
        if start == 0 || p.path != part {
            let _ = tokio::fs::remove_file(&p.path).await;
        }
    }

    let progress = |received: u64| {
        node.emit(
            EVENT_FILE_PROGRESS,
            FileProgress {
                peer_id,
                rel_path: &rel,
                received_bytes: received,
                total_bytes: size,
            },
        );
    };

    // On failure the partial file is kept so the next attempt can resume from it.
    receive_into(&mut recv, &part, start, size, &mut cancel, progress).await?;
    rename_with_retry(&part, &target)
        .await
        .map_err(|e| format!("Failed to save {rel}: {e}"))?;
    // Keep what arrived as a version, off the async threads since it reads the file back
    let (workspace, rel_copy, saved) = (workspace_path.to_string(), rel.clone(), target.clone());
    let _ = tokio::task::spawn_blocking(move || {
        crate::commands::workspace::versions::record_file(&workspace, &rel_copy, &saved, "sync")
    })
    .await;
    Ok(size)
}

/// Moves a finished download into place. A virus scanner or indexer can hold a file for a moment right after it is
/// written, and the folder is made again in case something removed it, so a failed rename is tried a few more times.
async fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut attempt = 0;
    loop {
        if let Some(parent) = to.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        match tokio::fs::rename(from, to).await {
            Err(e) if attempt < 4 && matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied) => {
                attempt += 1;
                tokio::time::sleep(Duration::from_millis(100 * attempt)).await;
            }
            other => return other,
        }
    }
}

/// A hidden partial download left by an interrupted transfer
struct Partial {
    path: PathBuf,
    version: u64,
    len: u64,
}

/// Looks next to `target` for `.{file_name}.{version}.nexsync-part`
async fn find_partial(target: &Path, file_name: &str) -> Option<Partial> {
    let prefix = format!(".{file_name}.");
    let mut entries = tokio::fs::read_dir(target.parent()?).await.ok()?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        let version = name
            .strip_prefix(&prefix)
            .and_then(|rest| rest.strip_suffix(".nexsync-part"))
            .and_then(|v| v.parse::<u64>().ok());
        if let (Some(version), Ok(meta)) = (version, entry.metadata().await) {
            return Some(Partial { path: entry.path(), version, len: meta.len() });
        }
    }
    None
}

/// Identifies one revision of a source file; resuming is only safe while it is unchanged.
pub(super) fn version_of(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

async fn receive_into(
    recv: &mut RecvStream,
    part: &Path,
    start: u64,
    size: u64,
    cancel: &mut watch::Receiver<bool>,
    progress: impl Fn(u64),
) -> Result<(), String> {
    let mut file = if start > 0 {
        tokio::fs::OpenOptions::new().append(true).open(part).await
    } else {
        tokio::fs::File::create(part).await
    }
    .map_err(|e| format!("Failed to create file: {e}"))?;
    let mut buf = vec![0u8; BUFFER_SIZE];
    let mut received: u64 = start;
    let mut last_report = Instant::now();
    progress(received);

    while received < size {
        let want = (size - received).min(BUFFER_SIZE as u64) as usize;
        let read = tokio::select! {
            Ok(()) = cancel.changed() => {
                return Err("The transfer was cancelled. What arrived is kept, so it can resume later.".into());
            }
            read = tokio::time::timeout(STALL_TIMEOUT, recv.read(&mut buf[..want])) => read,
        };
        let n = match read {
            Err(_) => return Err("The transfer stalled and was cancelled.".into()),
            Ok(Err(e)) => return Err(format!("The transfer failed: {e}")),
            Ok(Ok(None)) => return Err("The collaborator stopped sending before the file was complete.".into()),
            Ok(Ok(Some(n))) => n,
        };
        file.write_all(&buf[..n])
            .await
            .map_err(|e| format!("Failed to write file: {e}"))?;
        received += n as u64;
        if last_report.elapsed() >= PROGRESS_INTERVAL {
            progress(received);
            last_report = Instant::now();
        }
    }

    file.flush().await.map_err(|e| format!("Failed to write file: {e}"))?;
    file.sync_all().await.map_err(|e| format!("Failed to write file: {e}"))?;
    progress(received);
    Ok(())
}

/// Answers one incoming file request stream from a connected peer
pub async fn serve(node: &Arc<Node>, mut send: SendStream, mut recv: RecvStream) {
    if let Err(e) = serve_inner(node, &mut send, &mut recv).await {
        eprintln!("[P2P] File request failed: {e}");
    }
}

async fn serve_inner(node: &Arc<Node>, send: &mut SendStream, recv: &mut RecvStream) -> Result<(), String> {
    let kind = tokio::time::timeout(REPLY_TIMEOUT, recv.read_u8())
        .await
        .map_err(|_| "request timed out".to_string())?
        .map_err(|e| e.to_string())?;
    if kind != wire::STREAM_FILE {
        let _ = send.reset(0u32.into());
        return Err(format!("unexpected stream kind {kind}"));
    }

    let request: FileRequest = tokio::time::timeout(REPLY_TIMEOUT, wire::read_json(recv, wire::MAX_SMALL_FRAME))
        .await
        .map_err(|_| "request timed out".to_string())??;

    match open_for_serving(node, &request.rel_path).await {
        Ok((mut file, size, version)) => {
            // Resume only when the requester's bytes came from this exact revision of the file.
            let offset = if version != 0 && request.version == version && request.offset <= size {
                request.offset
            } else {
                0
            };
            file.seek(std::io::SeekFrom::Start(offset)).await.map_err(|e| e.to_string())?;
            wire::write_json(send, &FileReply::Ok { size, version, offset }).await?;
            let mut limited = file.take(size - offset);
            tokio::io::copy(&mut limited, send).await.map_err(|e| e.to_string())?;
        }
        Err(error) => {
            wire::write_json(send, &FileReply::Error { error }).await?;
        }
    }
    let _ = send.finish();
    Ok(())
}

async fn open_for_serving(node: &Arc<Node>, rel_path: &str) -> Result<(tokio::fs::File, u64, u64), String> {
    let workspace = node
        .workspace_path()
        .ok_or("The collaborator doesn't have this workspace open right now.")?;
    let rel = check_rel_path(rel_path)?;
    let path = resolve_workspace_path(&workspace, &rel)?;

    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|_| format!("{rel} no longer exists on the collaborator's device."))?;
    if !meta.is_file() {
        return Err(format!("{rel} is not a file."));
    }
    if meta.len() > MAX_TRANSFER_BYTES {
        return Err(format!("{rel} is too large to transfer."));
    }
    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| format!("Failed to open {rel}: {e}"))?;
    Ok((file, meta.len(), version_of(&meta)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_rel_path_accepts_nested_files() {
        assert_eq!(check_rel_path("notes/a.md").unwrap(), "notes/a.md");
        assert_eq!(check_rel_path("/assets/img/logo.png").unwrap(), "assets/img/logo.png");
    }

    #[test]
    fn test_check_rel_path_rejects_unsafe_paths() {
        for bad in [
            "",
            "notes",
            "notes/",
            "tasks/x.json",
            ".nexsync/nexsync.db",
            "notes/../secret.txt",
            "notes/.hidden",
            "notes//a.md",
            "notes\\a.md",
            "notes/C:evil",
        ] {
            assert!(check_rel_path(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn test_walk_lists_nested_files_and_skips_hidden() {
        let root = std::env::temp_dir().join(format!("nexsync_p2p_walk_{}", uuid::Uuid::new_v4()));
        let notes = root.join("notes");
        std::fs::create_dir_all(notes.join("sub")).unwrap();
        std::fs::create_dir_all(notes.join(".cache")).unwrap();
        std::fs::write(notes.join("a.md"), "a").unwrap();
        std::fs::write(notes.join("sub").join("b.md"), "bb").unwrap();
        std::fs::write(notes.join(".hidden.md"), "x").unwrap();
        std::fs::write(notes.join(".cache").join("c.md"), "x").unwrap();

        let mut out = Vec::new();
        walk(&notes, "notes", 0, &mut out).unwrap();
        let mut paths: Vec<_> = out.iter().map(|f| (f.rel_path.as_str(), f.size)).collect();
        paths.sort();
        assert_eq!(paths, vec![("notes/a.md", 1), ("notes/sub/b.md", 2)]);

        let _ = std::fs::remove_dir_all(&root);
    }
}
