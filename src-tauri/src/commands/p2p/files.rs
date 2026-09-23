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
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::{
    node::Node,
    wire::{self, FileReply, FileRequest},
};
use crate::commands::path_utils::resolve_workspace_path;

pub const EVENT_FILE_PROGRESS: &str = "p2p://file-progress";

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

    let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
    send.write_all(&[wire::STREAM_FILE]).await.map_err(|e| e.to_string())?;
    wire::write_json(&mut send, &FileRequest { rel_path: rel.clone() }).await?;
    let _ = send.finish();

    let reply: FileReply = tokio::time::timeout(REPLY_TIMEOUT, wire::read_json(&mut recv, wire::MAX_SMALL_FRAME))
        .await
        .map_err(|_| "The collaborator didn't respond to the file request.".to_string())??;
    let size = match reply {
        FileReply::Ok { size } => size,
        FileReply::Error { error } => return Err(error),
    };
    if size > MAX_TRANSFER_BYTES {
        let _ = recv.stop(0u32.into());
        return Err(format!("{rel} is too large to transfer ({size} bytes)."));
    }

    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create folder for {rel}: {e}"))?;
    }
    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| format!("Invalid file path: {rel}"))?;
    // Hidden temp file so a partial download never shows up in the file list
    let part = target.with_file_name(format!(".{file_name}.nexsync-part"));

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

    match receive_into(&mut recv, &part, size, progress).await {
        Ok(()) => {
            tokio::fs::rename(&part, &target)
                .await
                .map_err(|e| format!("Failed to save {rel}: {e}"))?;
            Ok(size)
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&part).await;
            Err(e)
        }
    }
}

async fn receive_into(
    recv: &mut RecvStream,
    part: &Path,
    size: u64,
    progress: impl Fn(u64),
) -> Result<(), String> {
    let mut file = tokio::fs::File::create(part)
        .await
        .map_err(|e| format!("Failed to create file: {e}"))?;
    let mut buf = vec![0u8; BUFFER_SIZE];
    let mut received: u64 = 0;
    let mut last_report = Instant::now();
    progress(0);

    while received < size {
        let want = (size - received).min(BUFFER_SIZE as u64) as usize;
        let n = match tokio::time::timeout(STALL_TIMEOUT, recv.read(&mut buf[..want])).await {
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
        Ok((file, size)) => {
            wire::write_json(send, &FileReply::Ok { size }).await?;
            let mut limited = file.take(size);
            tokio::io::copy(&mut limited, send).await.map_err(|e| e.to_string())?;
        }
        Err(error) => {
            wire::write_json(send, &FileReply::Error { error }).await?;
        }
    }
    let _ = send.finish();
    Ok(())
}

async fn open_for_serving(node: &Arc<Node>, rel_path: &str) -> Result<(tokio::fs::File, u64), String> {
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
    Ok((file, meta.len()))
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
