//! Running a command in the workspace's `editor` folder and streaming its output to the Editor tab.
//!
//! Only the local user can start a run, from their own device; collaborators cannot trigger one.
//! Each run has an id so the UI can stop it, and output is capped so a chatty program cannot flood the UI.

use std::{
    collections::HashMap,
    path::Path,
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, BufReader},
    process::Command,
    sync::oneshot,
};

use crate::commands::{config::validate_allowed_root, path_utils::resolve_workspace_path};

pub const EVENT_RUN_OUTPUT: &str = "editor://run-output";
pub const EVENT_RUN_EXIT: &str = "editor://run-exit";

const MAX_COMMAND_LEN: usize = 2_000;
const MAX_LINES: usize = 20_000;
const MAX_LINE_LEN: usize = 4_000;
/// How long to wait for output to drain after a run is stopped
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

type Sink = Arc<dyn Fn(&'static str, String) + Send + Sync>;

/// Runs in progress, each with the switch that stops it
#[derive(Default)]
pub struct RunState {
    runs: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunOutput<'a> {
    run_id: &'a str,
    /// `stdout` or `stderr`
    stream: &'static str,
    text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunExit<'a> {
    run_id: &'a str,
    code: Option<i32>,
    stopped: bool,
    error: Option<String>,
}

#[cfg(windows)]
fn shell(command: &str) -> Command {
    let mut cmd = Command::new("cmd");
    cmd.arg("/C").arg(command);
    // No console window flashing up next to the app
    cmd.creation_flags(0x0800_0000);
    cmd
}

#[cfg(not(windows))]
fn shell(command: &str) -> Command {
    let mut cmd = Command::new("sh");
    cmd.arg("-c").arg(command);
    cmd
}

/// Ends the process and everything it started, since a shell does not pass a kill on to its children.
async fn stop(child: &mut tokio::process::Child) {
    #[cfg(windows)]
    if let Some(pid) = child.id() {
        let _ = std::process::Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).output();
    }
    let _ = child.kill().await;
}

async fn pump(reader: impl AsyncRead + Unpin, stream: &'static str, sink: Sink) {
    let mut reader = BufReader::new(reader);
    let mut buf = Vec::new();
    let mut lines = 0;
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        lines += 1;
        if lines > MAX_LINES {
            if lines == MAX_LINES + 1 {
                sink(stream, format!("[Output stopped after {MAX_LINES} lines.]"));
            }
            continue;
        }
        let mut text = String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).to_string();
        if text.chars().count() > MAX_LINE_LEN {
            text = text.chars().take(MAX_LINE_LEN).collect::<String>() + " [line cut]";
        }
        sink(stream, text);
    }
}

/// Runs `command` in `dir`, passing each output line to `sink`. Returns the exit code and whether it was stopped.
async fn run_streaming(
    dir: &Path,
    command: &str,
    mut stop_rx: oneshot::Receiver<()>,
    sink: Sink,
) -> Result<(Option<i32>, bool), String> {
    let mut child = shell(command)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Could not start the command: {e}"))?;
    let out = child.stdout.take().map(|r| tokio::spawn(pump(r, "stdout", sink.clone())));
    let err = child.stderr.take().map(|r| tokio::spawn(pump(r, "stderr", sink)));

    let (code, stopped) = tokio::select! {
        status = child.wait() => (status.ok().and_then(|s| s.code()), false),
        _ = &mut stop_rx => {
            stop(&mut child).await;
            (None, true)
        }
    };
    for task in [out, err].into_iter().flatten() {
        // A stopped program's grandchildren can keep the pipes open, so don't wait forever.
        let _ = tokio::time::timeout(DRAIN_TIMEOUT, task).await;
    }
    Ok((code, stopped))
}

/// Starts `command` in a folder of the workspace's editor area and returns the id of the run
#[tauri::command]
pub async fn run_command(
    app: AppHandle,
    state: State<'_, RunState>,
    workspace_path: String,
    dir: String,
    command: String,
) -> Result<String, String> {
    validate_allowed_root(&app, &workspace_path)?;
    let command = command.trim().to_string();
    if command.is_empty() || command.len() > MAX_COMMAND_LEN || command.contains('\0') {
        return Err("Enter a command to run.".to_string());
    }
    let dir = dir.trim_matches('/');
    if dir != "editor" && !dir.starts_with("editor/") {
        return Err("Commands run only inside the editor folder.".to_string());
    }
    let cwd = resolve_workspace_path(&workspace_path, dir)?;
    if !cwd.is_dir() {
        return Err("That folder does not exist.".to_string());
    }

    let run_id = uuid::Uuid::new_v4().to_string();
    let (stop_tx, stop_rx) = oneshot::channel();
    state.runs.lock().unwrap_or_else(|p| p.into_inner()).insert(run_id.clone(), stop_tx);

    let id = run_id.clone();
    let emitter = app.clone();
    let sink: Sink = Arc::new({
        let (app, id) = (app.clone(), run_id.clone());
        move |stream, text| {
            let _ = app.emit(EVENT_RUN_OUTPUT, RunOutput { run_id: &id, stream, text });
        }
    });
    tokio::spawn(async move {
        let result = run_streaming(&cwd, &command, stop_rx, sink).await;
        let (code, stopped, error) = match result {
            Ok((code, stopped)) => (code, stopped, None),
            Err(e) => (None, false, Some(e)),
        };
        let _ = emitter.emit(EVENT_RUN_EXIT, RunExit { run_id: &id, code, stopped, error });
        if let Some(runs) = emitter.try_state::<RunState>() {
            runs.runs.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
        }
    });
    Ok(run_id)
}

/// Stops a run started by [`run_command`]; does nothing if it already ended
#[tauri::command]
pub fn kill_run(state: State<'_, RunState>, run_id: String) {
    if let Some(stop_tx) = state.runs.lock().unwrap_or_else(|p| p.into_inner()).remove(&run_id) {
        let _ = stop_tx.send(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    type Lines = Arc<Mutex<Vec<(&'static str, String)>>>;

    fn collect() -> (Sink, Lines) {
        let lines: Lines = Arc::new(Mutex::new(Vec::new()));
        let store = lines.clone();
        (Arc::new(move |stream, text| store.lock().unwrap().push((stream, text))), lines)
    }

    #[tokio::test]
    async fn test_output_is_streamed_and_the_exit_code_reported() {
        let (sink, lines) = collect();
        let (_tx, rx) = oneshot::channel();
        let (code, stopped) =
            run_streaming(&std::env::temp_dir(), "echo hello && echo oops 1>&2 && exit 3", rx, sink).await.unwrap();
        assert_eq!((code, stopped), (Some(3), false));
        let lines = lines.lock().unwrap();
        assert!(lines.iter().any(|(s, t)| *s == "stdout" && t.trim() == "hello"), "{lines:?}");
        assert!(lines.iter().any(|(s, t)| *s == "stderr" && t.trim() == "oops"), "{lines:?}");
    }

    #[tokio::test]
    async fn test_a_running_command_can_be_stopped() {
        #[cfg(windows)]
        let long = "ping -n 30 127.0.0.1";
        #[cfg(not(windows))]
        let long = "sleep 30";
        let (sink, _lines) = collect();
        let (tx, rx) = oneshot::channel();
        let started = std::time::Instant::now();
        let handle = tokio::spawn({
            let dir = std::env::temp_dir();
            async move { run_streaming(&dir, long, rx, sink).await }
        });
        tokio::time::sleep(Duration::from_millis(500)).await;
        tx.send(()).unwrap();
        let (code, stopped) = handle.await.unwrap().unwrap();
        assert!(stopped && code.is_none());
        assert!(started.elapsed() < Duration::from_secs(10), "stopping must not wait for the command");
    }
}
