// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
mod database;
mod crypto;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            crypto::init().map_err(|e| format!("Crypto initialization failed: {e}"))?;
            commands::auth::init();
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // Session management (C1: Authentication)
            commands::auth::create_workspace_session,
            commands::auth::close_workspace_session,
            commands::auth::get_current_session_info,
            
            // Config management (C3: Allowed roots configuration)
            commands::config::load_config_cmd,
            commands::config::save_config_cmd,
            commands::config::validate_allowed_root_cmd,
            
            // Workspace commands
            commands::workspace::create_workspace,
            commands::workspace::import_workspace,
            commands::workspace::read_workspace_metadata,
            commands::workspace::write_workspace_metadata,
            commands::workspace::list_workspace_files,
            commands::workspace::create_workspace_item,
            commands::workspace::read_workspace_file,
            commands::workspace::write_workspace_file,
            commands::workspace::delete_workspace_item,
            commands::workspace::rename_workspace_item,
            commands::workspace::get_workspace_stats,
            commands::workspace::log_error,
            commands::workspace::get_recent_workspaces,
            commands::workspace::get_last_workspace,
            commands::workspace::set_last_workspace,
            commands::workspace::clear_last_workspace,
            commands::workspace::add_recent_workspace,
            commands::workspace::remove_recent_workspace,
            commands::workspace::get_tasks,
            commands::workspace::create_task,
            commands::workspace::update_task,
            commands::workspace::delete_task,
            commands::workspace::get_kanban,
            commands::workspace::create_kanban_column,
            commands::workspace::create_kanban_card,
            commands::workspace::update_kanban_card,
            commands::workspace::move_kanban_card,
            commands::workspace::delete_kanban_column,
            commands::workspace::delete_kanban_card,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
