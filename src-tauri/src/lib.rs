mod commands;
mod database;
#[allow(dead_code)]
pub mod crypto;

/// Initializes plugins, registers Tauri command handlers, and runs the application
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            // Initialize cryptography subsystem and auth registry
            crypto::init().map_err(|e| format!("Crypto initialization failed: {e}"))?;
            commands::auth::init();
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // Session management
            commands::auth::create_workspace_session,
            commands::auth::close_workspace_session,
            commands::auth::get_current_session_info,
            
            // Allowed roots configuration
            commands::config::load_config_cmd,
            commands::config::save_config_cmd,
            commands::config::validate_allowed_root_cmd,
            
            // Workspace lifecycle & metadata
            commands::workspace::create_workspace,
            commands::workspace::import_workspace,
            commands::workspace::read_workspace_metadata,
            commands::workspace::write_workspace_metadata,
            commands::workspace::get_workspace_stats,
            commands::workspace::log_error,

            // Workspace filesystem operations
            commands::workspace::list_workspace_files,
            commands::workspace::create_workspace_item,
            commands::workspace::read_workspace_file,
            commands::workspace::write_workspace_file,
            commands::workspace::read_workspace_binary_file,
            commands::workspace::write_workspace_binary_file,
            commands::workspace::import_asset_from_path,
            commands::workspace::delete_workspace_item,
            commands::workspace::rename_workspace_item,

            // Workspace registry & session restoration
            commands::workspace::get_recent_workspaces,
            commands::workspace::get_last_workspace,
            commands::workspace::set_last_workspace,
            commands::workspace::clear_last_workspace,
            commands::workspace::add_recent_workspace,
            commands::workspace::remove_recent_workspace,

            // Tasks
            commands::workspace::get_tasks,
            commands::workspace::create_task,
            commands::workspace::update_task,
            commands::workspace::delete_task,

            // Kanban board
            commands::workspace::get_kanban,
            commands::workspace::create_kanban_column,
            commands::workspace::create_kanban_card,
            commands::workspace::update_kanban_card,
            commands::workspace::move_kanban_card,
            commands::workspace::delete_kanban_column,
            commands::workspace::delete_kanban_card,

            // Yjs CRDT binary document persistence
            commands::workspace::get_yjs_doc,
            commands::workspace::save_yjs_doc,
            commands::workspace::delete_yjs_doc,
            commands::workspace::list_yjs_docs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
