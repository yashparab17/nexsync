//! Terminals in the Editor's bottom panel: real shells in pseudo-terminals, like the integrated terminal in VS Code.
//!
//! Only the local user opens one, on their own device, starting in the workspace's `editor` folder. Output goes to the
//! panel as base64 chunks of raw bytes, so multi-byte characters split between reads arrive intact.

use std::{collections::HashMap, sync::{Arc, Mutex}};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::commands::{config::validate_allowed_root, path_utils::resolve_workspace_path, terminal_pty::{self, PtySession, Shell}};

pub const EVENT_TERMINAL_DATA: &str = "terminal://data";
pub const EVENT_TERMINAL_EXIT: &str = "terminal://exit";

const MAX_TERMINALS: usize = 12;

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
}

#[derive(Clone, Serialize)]
struct TerminalData<'a> {
    id: &'a str,
    /// Base64 of the raw bytes
    data: String,
}

#[derive(Clone, Serialize)]
struct TerminalExit<'a> {
    id: &'a str,
    code: Option<u32>,
}

fn session(state: &TerminalState, id: &str) -> Result<Arc<PtySession>, String> {
    state.sessions.lock().unwrap_or_else(|p| p.into_inner()).get(id).cloned().ok_or_else(|| "That terminal has ended.".to_string())
}

/// Opens a shell in a folder of the workspace's editor area and returns its id
#[tauri::command]
pub fn terminal_open(
    app: AppHandle,
    state: State<'_, TerminalState>,
    workspace_path: String,
    dir: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
) -> Result<String, String> {
    validate_allowed_root(&app, &workspace_path)?;
    let dir = dir.trim_matches('/');
    if dir != "editor" && !dir.starts_with("editor/") {
        return Err("Terminals start only inside the editor folder.".to_string());
    }
    let cwd = resolve_workspace_path(&workspace_path, dir)?;
    if dir == "editor" {
        std::fs::create_dir_all(&cwd).map_err(|e| format!("Could not create the editor folder: {e}"))?;
    }
    if !cwd.is_dir() {
        return Err("That folder does not exist.".to_string());
    }
    if state.sessions.lock().unwrap_or_else(|p| p.into_inner()).len() >= MAX_TERMINALS {
        return Err(format!("Close a terminal first; at most {MAX_TERMINALS} can be open."));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let (data_app, data_id) = (app.clone(), id.clone());
    let (exit_app, exit_id) = (app.clone(), id.clone());
    let pty = PtySession::spawn(
        &cwd,
        cols,
        rows,
        shell.as_deref(),
        move |bytes| {
            let _ = data_app.emit(EVENT_TERMINAL_DATA, TerminalData { id: &data_id, data: STANDARD.encode(bytes) });
        },
        move |code| {
            let _ = exit_app.emit(EVENT_TERMINAL_EXIT, TerminalExit { id: &exit_id, code });
        },
    )?;
    state.sessions.lock().unwrap_or_else(|p| p.into_inner()).insert(id.clone(), Arc::new(pty));
    Ok(id)
}

/// The shells installed here, the default first
#[tauri::command]
pub fn terminal_shells() -> Vec<Shell> {
    terminal_pty::shells()
}

/// Keys typed into the terminal, as the text the panel's emulator produced
#[tauri::command]
pub fn terminal_write(state: State<'_, TerminalState>, id: String, data: String) -> Result<(), String> {
    session(&state, &id)?.write(data.as_bytes())
}

#[tauri::command]
pub fn terminal_resize(state: State<'_, TerminalState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    session(&state, &id)?.resize(cols, rows)
}

/// Ends the shell and forgets the terminal; does nothing if it already ended
#[tauri::command]
pub fn terminal_close(state: State<'_, TerminalState>, id: String) {
    // Dropping the last handle kills the shell
    state.sessions.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
}
