use std::fs;
use std::io::Write;

use super::helpers::error_log_path;
use super::models::ErrorRecord;

// ────────────────────────────
// Tauri commands — Error logging
// ────────────────────────────

#[tauri::command]
pub fn log_error(app_handle: tauri::AppHandle, entry: ErrorRecord) -> Result<(), String> {
    let path = error_log_path(&app_handle)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
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