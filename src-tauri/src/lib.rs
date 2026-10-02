mod commands;
mod database;

/// Initializes plugins, registers Tauri command handlers, and runs the application
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::p2p::P2pState::default())
        .manage(commands::editor_run::RunState::default())
        .setup(|app| {
            // Initialize the session auth registry
            commands::auth::init();
            // Writes to tasks and cards are signed with the key this device is known by to collaborators
            if let Some(key) = commands::p2p::identity(app.handle()) {
                commands::workspace::signing::init(key);
            }
            // The updater checks GitHub Releases for a signed newer build; desktop-only, like
            // upstream's own scaffold, since there's nothing to update on mobile app stores.
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
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
            commands::workspace::get_error_log,
            commands::workspace::clear_error_log,

            // Workspace filesystem operations
            commands::workspace::list_workspace_files,
            commands::workspace::search_workspace_files,
            commands::workspace::create_workspace_item,
            commands::workspace::read_workspace_file,
            commands::workspace::write_workspace_file,
            commands::workspace::versions::list_file_versions,
            commands::workspace::versions::record_file_version,
            commands::workspace::versions::read_file_version,
            commands::workspace::versions::restore_file_version,
            commands::workspace::versions::receive_named_version,
            commands::workspace::export::export_zip,
            commands::workspace::export::write_export_file,
            commands::workspace::read_workspace_binary_file,
            commands::workspace::write_workspace_binary_file,
            commands::workspace::import_asset_from_path,
            commands::workspace::delete_workspace_item,
            commands::workspace::delete_workspace,
            commands::workspace::list_trash,
            commands::workspace::restore_trash_item,
            commands::workspace::purge_trash_item,
            commands::workspace::empty_trash,
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
            commands::workspace::data_sync::export_task_record,
            commands::workspace::data_sync::export_card_record,
            commands::workspace::data_sync::merge_task_record,
            commands::workspace::data_sync::merge_card_record,
            commands::workspace::data_sync::resolve_task_conflict,
            commands::workspace::data_sync::resolve_card_conflict,
            commands::workspace::catchup::get_catchup,
            commands::workspace::catchup::mark_catchup,
            commands::workspace::catchup::add_text_catchup,
            commands::workspace::invariants::get_rules,
            commands::workspace::invariants::set_rule,
            commands::workspace::drafts::list_drafts,
            commands::workspace::drafts::start_draft,
            commands::workspace::drafts::get_draft,
            commands::workspace::drafts::save_draft,
            commands::workspace::drafts::preview_draft,
            commands::workspace::drafts::merge_draft,
            commands::workspace::drafts::discard_draft,
            commands::workspace::drafts::list_board_drafts,
            commands::workspace::drafts::start_board_draft,
            commands::workspace::drafts::get_board_draft,
            commands::workspace::drafts::move_in_board_draft,
            commands::workspace::drafts::preview_board_draft,
            commands::workspace::drafts::merge_board_draft,
            commands::workspace::drafts::discard_board_draft,
            commands::workspace::create_kanban_column,
            commands::workspace::create_kanban_card,
            commands::workspace::update_kanban_card,
            commands::workspace::move_kanban_card,
            commands::workspace::delete_kanban_column,
            commands::workspace::delete_kanban_card,

            // Yjs CRDT binary document persistence
            commands::workspace::get_yjs_doc,
            commands::workspace::save_yjs_doc,
            commands::workspace::rename_yjs_doc,
            commands::workspace::delete_yjs_doc,

            // P2P collaboration (Iroh)
            commands::p2p::p2p_set_workspace,
            commands::p2p::p2p_create_invite,
            commands::p2p::p2p_revoke_invite,
            commands::p2p::p2p_block_device,
            commands::p2p::p2p_set_known_members,
            commands::p2p::p2p_create_short_code,
            commands::p2p::p2p_resolve_join_request,
            commands::p2p::p2p_join_with_code,
            commands::p2p::p2p_join,
            commands::p2p::p2p_send,
            commands::p2p::p2p_list_peers,
            commands::workspace::list_yjs_docs,
            commands::editor_run::run_command,
            commands::editor_run::kill_run,
            commands::system_open::open_workspace_file,
            commands::p2p::p2p_self_id,
            commands::p2p::p2p_cancel_transfers,
            commands::p2p::p2p_set_roles,
            commands::p2p::p2p_disconnect,
            commands::p2p::p2p_disconnect_all,
            commands::p2p::p2p_retry_connection,
            commands::p2p::p2p_network_status,
            commands::p2p::p2p_network_change,
            commands::p2p::p2p_fetch_file,
            commands::p2p::p2p_list_shareable_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
