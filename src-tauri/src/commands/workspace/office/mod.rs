//! Office documents, spreadsheets and slide decks (Phase 21): reading and writing their files, and the engines behind the editors.
//! `documents` (Word-style files and PDF), `sheets` and `sheet_tools` (workbooks), `slides` (decks), `proof` (spelling and grammar).

pub mod blocks;
pub mod documents;
pub mod merge;
pub mod presets;
pub mod proof;
pub mod sheet_tools;
pub mod sheets;
pub mod slides;

/// Keeps a saved Office file in the workspace's version history: what was there before (so an update can be undone even the first
/// time) and what was written. A file outside the workspace, or of another kind, is left alone; history is never a reason to fail a save.
pub fn keep_versions(workspace: &str, dest: &std::path::Path, before: bool, bytes: &[u8]) {
    let office = dest.extension().and_then(|e| e.to_str()).is_some_and(|e| ["docx", "xlsx", "pptx"].contains(&e.to_ascii_lowercase().as_str()));
    let Ok(root) = crate::commands::path_utils::resolve_workspace_path(workspace, ".").and_then(|r| r.canonicalize().map_err(|e| e.to_string())) else { return };
    let Some(rel) = dest.canonicalize().ok().or_else(|| dest.parent()?.canonicalize().ok().map(|p| p.join(dest.file_name().unwrap_or_default()))).and_then(|d| d.strip_prefix(&root).ok().map(|r| r.to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/"))) else { return };
    if !office {
        return;
    }
    if before && dest.is_file() {
        let _ = super::versions::record_file(workspace, &rel, dest, "save");
    }
    if !before {
        let _ = super::versions::record_bytes(workspace, &rel, bytes, "save", None);
    }
}
