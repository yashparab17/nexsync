//! Error logging command that appends records to `errors.jsonl`.

use std::fs;
use std::io::Write;
use super::helpers::error_log_path;
use super::models::ErrorRecord;

const MAX_LOG_FILE_SIZE: u64 = 5 * 1024 * 1024; // 5 MB
const MAX_MESSAGE_LEN: usize = 2048;
const MAX_DETAIL_LEN: usize = 8192;

// ────────────────────────────
// Tauri commands — Error logging
// ────────────────────────────

/// Appends a new error record to the application error log
#[tauri::command]
pub fn log_error(app_handle: tauri::AppHandle, mut entry: ErrorRecord) -> Result<(), String> {
    // Truncate fields to max lengths
    if entry.message.len() > MAX_MESSAGE_LEN {
        entry.message.truncate(MAX_MESSAGE_LEN);
    }
    if entry.source.len() > 128 {
        entry.source.truncate(128);
    }
    if let Some(detail) = &mut entry.detail {
        if detail.len() > MAX_DETAIL_LEN {
            detail.truncate(MAX_DETAIL_LEN);
        }
    }
    if let Some(ws) = &mut entry.workspace {
        if ws.len() > 512 {
            ws.truncate(512);
        }
    }

    let path = error_log_path(&app_handle)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Rotate log file if exceeding size limit
    if let Ok(metadata) = fs::metadata(&path) {
        if metadata.len() > MAX_LOG_FILE_SIZE {
            if let Ok(content) = fs::read_to_string(&path) {
                let lines: Vec<&str> = content.lines().collect();
                let keep_count = lines.len() / 2;
                let trimmed = lines[keep_count..].join("\n") + "\n";
                let _ = fs::write(&path, trimmed);
            }
        }
    }

    // Append JSON line
    let mut line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    line.push('\n');
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(line.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(())
}