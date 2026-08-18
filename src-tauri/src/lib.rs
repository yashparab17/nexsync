// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::workspace::create_workspace,
            commands::workspace::import_workspace,
            commands::workspace::read_workspace_metadata,
            commands::workspace::write_workspace_metadata,
            commands::workspace::read_workspace_json,
            commands::workspace::write_workspace_json,
            commands::workspace::list_workspace_files,
            commands::workspace::get_workspace_stats,
            commands::workspace::log_error,
            commands::workspace::get_recent_workspaces,
            commands::workspace::get_last_workspace,
            commands::workspace::set_last_workspace,
            commands::workspace::clear_last_workspace,
            commands::workspace::add_recent_workspace,
            commands::workspace::remove_recent_workspace,
            commands::files::list_files,
            commands::files::read_workspace_file,
            commands::files::write_workspace_file,
            commands::files::create_workspace_folder,
            commands::files::delete_workspace_entry,
            commands::files::rename_workspace_entry,
            commands::files::import_files_into_workspace,
            commands::files::export_workspace_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
