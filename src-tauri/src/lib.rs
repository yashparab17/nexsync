mod commands;
mod database;

/// Development only: the office engines, for `examples/office_dev.rs`, which lets the editors run in a browser
#[cfg(debug_assertions)]
pub mod lab {
    pub use crate::commands::workspace::office::{documents as office, fonts, sheet_tools, sheets, slides as deck};
}

/// What the command-line tool (`src/bin/nexsync-cli.rs`) uses: the document engines, with no window
pub mod cli {
    pub use crate::commands::workspace::office::documents::{convert_bytes as convert, inspect_bytes as inspect, text_bytes as text, Inspect};

    /// Word's downloaded fonts (Aptos and others), so that a document set in them is laid out as Word lays it out
    pub fn load_fonts() {
        crate::commands::workspace::office::fonts::load_fonts();
    }
}

/// Initializes plugins, registers Tauri command handlers, and runs the application
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::p2p::P2pState::default())
        .manage(commands::editor_run::RunState::default())
        .manage(commands::workspace::projects::tasks::TaskState::default())
        .manage(commands::workspace::projects::lsp::LspState::default())
        .manage(commands::terminal::TerminalState::default())
        .setup(|app| {
            // A crash leaves a record in the local error log
            commands::workspace::install_panic_hook(app.handle().clone());
            // Initialize the session auth registry
            commands::auth::init();
            // Writes to tasks and cards are signed with the key this device is known by to collaborators
            if let Some(key) = commands::p2p::identity(app.handle()) {
                commands::workspace::signing::init(key);
            }
            // Font discovery is the first-open cost of a document: pay it now, off the main thread
            std::thread::spawn(|| {
                // Word's downloaded fonts (Aptos...) first, so documents set in them are laid out as Word lays them out
                let _ = commands::workspace::office::fonts::load_fonts();
                let _ = wordcraft_fonts::word::resolve("Calibri", false, false);
            });
            // The updater checks GitHub Releases for a signed newer build; desktop-only, like
            // upstream's own scaffold, since there's nothing to update on mobile app stores.
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        // Only its show_snap_overlay command is used, by the title bar's maximize button (Windows 11 snap layouts)
        .invoke_handler(tauri::generate_handler![
            // Updates
            commands::updates::check_for_update,
            commands::updates::install_update,
            // Session management
            commands::auth::create_workspace_session,
            commands::auth::close_workspace_session,
            commands::auth::get_current_session_info,
            
            // Allowed roots configuration
            commands::config::load_config_cmd,
            commands::config::default_display_name,
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
            commands::workspace::erase_record_for_good,
            commands::workspace::erase_file_for_good,

            // Kanban board
            commands::workspace::get_kanban,
            commands::workspace::data_sync::export_task_record,
            commands::workspace::data_sync::export_card_record,
            commands::workspace::data_sync::merge_task_record,
            commands::workspace::data_sync::merge_card_record,
            commands::workspace::data_sync::resolve_task_conflict,
            commands::workspace::data_sync::resolve_card_conflict,
            commands::workspace::catchup::get_catchup,
            commands::workspace::catchup::get_member_changes,
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
            commands::workspace::get_yjs_doc_raw,
            commands::workspace::save_yjs_doc_raw,
            commands::workspace::rename_yjs_doc,
            commands::workspace::delete_yjs_doc,

            // P2P collaboration (Iroh)
            commands::p2p::p2p_set_workspace,
            commands::p2p::p2p_create_invite,
            commands::p2p::p2p_revoke_invite,
            commands::p2p::p2p_block_device,
            commands::p2p::p2p_set_known_members,
            commands::p2p::p2p_probe_member,
            commands::p2p::p2p_adopt_membership,
            commands::p2p::p2p_handoff_membership,
            commands::p2p::p2p_create_short_code,
            commands::p2p::p2p_resolve_join_request,
            commands::p2p::p2p_join_with_code,
            commands::p2p::p2p_join,
            commands::p2p::p2p_send,
            commands::p2p::p2p_list_peers,
            commands::workspace::list_yjs_docs,
            commands::editor_run::run_command,
            commands::editor_run::kill_run,
            commands::terminal::terminal_open,
            commands::terminal::terminal_shells,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
            commands::system_open::open_workspace_file,
            commands::p2p::p2p_self_id,
            commands::p2p::p2p_cancel_transfers,
            commands::p2p::p2p_set_roles,
            commands::p2p::chat::chat_post,
            commands::p2p::chat::dm_seal,
            commands::p2p::chat::dm_channel,
            commands::p2p::chat::dm_open,
            commands::p2p::chat::chat_get_history_limit,
            commands::p2p::chat::chat_set_history_limit,
            commands::p2p::chat::moderation_state,
            commands::workspace::crdt::record_history,
            commands::workspace::chat::announce::expiry_sweep,
            commands::workspace::bundle::bundle_export,
            commands::workspace::bundle::bundle_inspect,
            commands::workspace::bundle::bundle_import,
            commands::workspace::held::held_list,
            commands::workspace::held::held_accept,
            commands::workspace::held::held_discard,
            commands::workspace::held::held_entries_list,
            commands::workspace::held::held_entry_accept,
            commands::workspace::held::held_entry_discard,
            commands::workspace::held::held_review_get,
            commands::workspace::held::held_review_set,
            commands::p2p::chat::chat_state,
            commands::p2p::chat::chat_mark_read,
            commands::p2p::chat::chat_set_muted,
            commands::p2p::chat::inbox_list,
            commands::p2p::chat::inbox_add,
            commands::p2p::chat::inbox_mark_read,
            commands::p2p::chat::inbox_clear,
            commands::p2p::p2p_disconnect,
            commands::p2p::p2p_disconnect_all,
            commands::p2p::p2p_retry_connection,
            commands::p2p::p2p_network_status,
            commands::p2p::p2p_network_change,
            commands::p2p::p2p_fetch_file,
            commands::p2p::p2p_list_shareable_files,
            commands::workspace::projects::projects_list,
            commands::workspace::projects::project_save_recipe,
            commands::workspace::projects::project_create,
            commands::workspace::projects::project_add_ignore,
            commands::workspace::projects::doctor::project_doctor,
            commands::workspace::projects::scan::project_scan,
            commands::workspace::projects::scan::project_secret_allow,
            commands::workspace::office::slides::deck_new,
            commands::workspace::office::slides::deck_open,
            commands::workspace::office::slides::deck_register,
            commands::workspace::office::slides::deck_render,
            commands::workspace::office::slides::deck_layouts,
            commands::workspace::office::slides::deck_new_slide,
            commands::workspace::office::slides::deck_new_shape,
            commands::workspace::office::slides::deck_edit_shape,
            commands::workspace::office::slides::deck_edit_slide,
            commands::workspace::office::slides::deck_add_picture,
            commands::workspace::office::slides::deck_text_of,
            commands::workspace::office::slides::deck_save,
            commands::workspace::office::sheets::sheet_calculate,
            commands::workspace::office::sheets::sheet_restructure,
            commands::workspace::office::proof::proof_check,
            commands::workspace::office::sheet_tools::sheet_sort,
            commands::workspace::office::sheet_tools::sheet_chart,
            commands::workspace::office::sheets::sheet_open,
            commands::workspace::office::sheets::sheet_save,
            commands::workspace::office::documents::office_import,
            commands::workspace::office::compare::office_version_lines,
            commands::workspace::office::documents::office_render,
            commands::workspace::office::documents::office_layout,
            commands::workspace::office::documents::office_page,
            commands::workspace::office::documents::office_margins,
            commands::workspace::office::documents::office_export,
            commands::workspace::office::documents::office_inspect,
            commands::workspace::projects::lsp::lsp_status,
            commands::workspace::projects::lsp::lsp_enable,
            commands::workspace::projects::lsp::lsp_sync,
            commands::workspace::projects::lsp::lsp_close,
            commands::workspace::projects::lsp::lsp_request,
            commands::workspace::projects::runtime::project_runtime,
            commands::workspace::projects::runtime::project_runtime_set,
            commands::workspace::projects::containers::project_containers,
            commands::workspace::projects::audit::project_audit,
            commands::workspace::projects::search::project_search,
            commands::workspace::projects::search::project_replace,
            commands::workspace::projects::impact::project_test_impact,
            commands::workspace::projects::bisect::project_bisect,
            commands::workspace::projects::bisect::project_bisect_cancel,
            commands::workspace::projects::http::project_http_files,
            commands::workspace::projects::http::project_http_send,
            commands::workspace::projects::generators::project_generators,
            commands::workspace::projects::generators::project_generate,
            commands::workspace::projects::reports::project_reports,
            commands::workspace::projects::reports::project_read_report,
            commands::workspace::projects::templates::project_templates,
            commands::workspace::projects::templates::project_scaffold_preview,
            commands::workspace::projects::templates::project_scaffold,
            commands::workspace::projects::templates::project_import_preview,
            commands::workspace::projects::templates::project_import,
            commands::workspace::projects::tasks::project_task_trust,
            commands::workspace::projects::tasks::project_task_approve,
            commands::workspace::projects::tasks::project_task_start,
            commands::workspace::projects::tasks::project_task_stop,
            commands::workspace::projects::tasks::project_runs,
            commands::workspace::projects::tasks::project_run_log,
            commands::workspace::projects::env::project_env_status,
            commands::workspace::projects::env::project_env_set,
            commands::workspace::projects::env::project_env_clear,
            commands::workspace::projects::env::project_deps_status,
            commands::workspace::projects::env::project_deps_mark,
            commands::p2p::p2p_hold_incoming,
            commands::p2p::p2p_held_count,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Language servers are programs of their own: end them with the app
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                if let Some(state) = app.try_state::<commands::workspace::projects::lsp::LspState>() {
                    tauri::async_runtime::block_on(state.stop_all());
                }
            }
        });
}
