//! Opening a workspace file in the app the operating system uses for that file type.

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::commands::{config::validate_allowed_root, path_utils::resolve_workspace_path};

/// Opens a workspace file, such as a Word document, in the system's default app
#[tauri::command]
pub fn open_workspace_file(app: AppHandle, workspace_path: String, rel_path: String) -> Result<(), String> {
    validate_allowed_root(&app, &workspace_path)?;
    let path = resolve_workspace_path(&workspace_path, &rel_path)?;
    if !path.is_file() {
        return Err("That file no longer exists.".to_string());
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Could not open the file: {e}"))
}
