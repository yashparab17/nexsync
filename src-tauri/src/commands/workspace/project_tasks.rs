//! Running a project's tasks (Phase 20, step 3): the approval a command needs on this device, the run itself with its output, the
//! port and the problems it reports, and a short history of runs that stays on this device.
//!
//! A task's command comes from a recipe that other people can change, so nothing starts until this device's owner has approved
//! that exact command (once, or always). The approval is a fingerprint of the project, the task, its folder, its command and the
//! variable names it uses: any change to one of them asks again. Only this device's page can start a run; a collaborator cannot.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

use super::{
    project_env,
    projects::{project_dir, tasks_of, TaskSpec},
};
use crate::commands::{config::validate_allowed_root, editor_run::{run_streaming, Sink}};

pub const EVENT_OUTPUT: &str = "project://output";
pub const EVENT_EXIT: &str = "project://exit";
pub const EVENT_READY: &str = "project://ready";
pub const EVENT_PORT: &str = "project://port";
pub const EVENT_PROBLEM: &str = "project://problem";

const MAX_RESTARTS: u32 = 3;
const MAX_LOG_LINES: usize = 5_000;
const KEEP_RUNS: usize = 30;
const READY_WAIT: Duration = Duration::from_secs(180);

// ────────────────────────────
// Approval
// ────────────────────────────

/// What approving a task covers: the project, the task, where it starts, the command and the variable names
pub fn fingerprint(project: &str, task: &TaskSpec) -> String {
    let mut env = task.env.clone();
    env.sort();
    blake3::hash(format!("{project}\0{}\0{}\0{}\0{}", task.id, task.cwd, task.command, env.join(",")).as_bytes()).to_hex().to_string()
}

#[derive(Serialize, Deserialize, Default)]
struct TrustFile {
    approved: HashSet<String>,
    /// The command last approved or run for `project/task`, to show what changed when it asks again
    last: HashMap<String, String>,
}

fn trust_path(workspace: &str) -> PathBuf {
    Path::new(workspace).join(".nexsync").join("project-trust.json")
}

fn load_trust(workspace: &str) -> TrustFile {
    fs::read_to_string(trust_path(workspace)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save_trust(workspace: &str, trust: &TrustFile) -> Result<(), String> {
    fs::create_dir_all(Path::new(workspace).join(".nexsync")).map_err(|e| e.to_string())?;
    fs::write(trust_path(workspace), serde_json::to_string(trust).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn find_task(workspace: &str, project: &str, task_id: &str) -> Result<(PathBuf, TaskSpec), String> {
    let dir = project_dir(workspace, project)?;
    let task = tasks_of(&dir).into_iter().find(|t| t.id == task_id).ok_or("This project has no task with that name.")?;
    Ok((dir, task))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trust {
    pub trusted: bool,
    pub command: String,
    pub cwd: String,
    pub env: Vec<String>,
    /// The command that was approved before, when this one is not the same
    pub changed_from: Option<String>,
}

/// Whether this device has approved the task as it is now, and what to show if not
#[tauri::command]
pub fn project_task_trust(app_handle: AppHandle, path: String, project: String, task_id: String) -> Result<Trust, String> {
    validate_allowed_root(&app_handle, &path)?;
    let (_, task) = find_task(&path, &project, &task_id)?;
    let trust = load_trust(&path);
    let previous = trust.last.get(&format!("{project}/{task_id}")).cloned().filter(|c| *c != task.command);
    Ok(Trust { trusted: trust.approved.contains(&fingerprint(&project, &task)), command: task.command, cwd: task.cwd, env: task.env, changed_from: previous })
}

/// "Always for this command"
#[tauri::command]
pub fn project_task_approve(app_handle: AppHandle, path: String, project: String, task_id: String) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    let (_, task) = find_task(&path, &project, &task_id)?;
    let mut trust = load_trust(&path);
    trust.approved.insert(fingerprint(&project, &task));
    trust.last.insert(format!("{project}/{task_id}"), task.command);
    save_trust(&path, &trust)
}

// ────────────────────────────
// What a task prints
// ────────────────────────────

/// The text without the colour and cursor codes programs put in it
pub fn strip_ansi(text: &str) -> String {
    static ANSI: LazyLock<Regex> = LazyLock::new(|| Regex::new("\u{1b}\\[[0-9;?]*[ -/]*[@-~]").unwrap());
    ANSI.replace_all(text, "").into_owned()
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Problem {
    pub file: String,
    pub line: u32,
    pub column: u32,
    /// `error` or `warning`
    pub severity: String,
    pub message: String,
}

/// Turns compiler and linter output into places in files. Most formats put everything on one line; Rust's puts the message and
/// the place on two, so the last message is kept until its place comes.
#[derive(Default)]
pub struct Problems {
    pending: Option<(String, String)>,
}

impl Problems {
    pub fn feed(&mut self, raw: &str) -> Option<Problem> {
        // `path(12,5): error CS1002: message` (TypeScript, .NET) and `path:12:5: error: message` (GCC, Clang, Go, Rust's short form)
        static PAREN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(?P<file>.+?)\((?P<line>\d+)[,:](?P<col>\d+)\):\s*(?P<sev>error|warning)\s*(?:\w+)?:?\s*(?P<msg>.+)$").unwrap());
        static COLON: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(?P<file>(?:[A-Za-z]:)?[^\s:][^:]*?):(?P<line>\d+):(?P<col>\d+):\s*(?:(?P<sev>fatal error|error|warning)[:\s]\s*)?(?P<msg>.+)$").unwrap());
        // Maven: `[ERROR] /path/File.java:[12,5] message`
        static MAVEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\[(?P<sev>ERROR|WARNING)\]\s+(?P<file>.+?):\[(?P<line>\d+),(?P<col>\d+)\]\s*(?P<msg>.+)$").unwrap());
        // Rust: `error[E0425]: cannot find value` then ` --> src/main.rs:3:5`
        static RUST_HEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?P<sev>error|warning)(?:\[\w+\])?:\s*(?P<msg>.+)$").unwrap());
        static RUST_AT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*-->\s*(?P<file>.+?):(?P<line>\d+):(?P<col>\d+)\s*$").unwrap());
        // Python: `  File "app.py", line 12, in main`
        static PYTHON: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"^\s*File "(?P<file>.+?)", line (?P<line>\d+)(?:, in (?P<name>.+))?$"#).unwrap());

        let text = strip_ansi(raw);
        let line = text.trim_end();
        let make = |c: &regex::Captures, sev: Option<&str>, msg: &str| Problem {
            file: c["file"].trim().replace('\\', "/"),
            line: c["line"].parse().unwrap_or(0),
            column: c.name("col").and_then(|m| m.as_str().parse().ok()).unwrap_or(0),
            severity: if sev.is_some_and(|s| s.to_lowercase().contains("warn")) { "warning" } else { "error" }.to_string(),
            message: msg.trim().chars().take(300).collect(),
        };
        if let Some(c) = RUST_AT.captures(line) {
            let (sev, msg) = self.pending.take()?;
            return Some(make(&c, Some(&sev), &msg));
        }
        if let Some(c) = RUST_HEAD.captures(line) {
            self.pending = Some((c["sev"].to_string(), c["msg"].to_string()));
            return None;
        }
        if let Some(c) = MAVEN.captures(line) {
            return Some(make(&c, Some(&c["sev"]), &c["msg"]));
        }
        if let Some(c) = PAREN.captures(line) {
            return Some(make(&c, Some(&c["sev"]), &c["msg"]));
        }
        if let Some(c) = PYTHON.captures(line) {
            // A traceback names where each call was; the last one before the message is the useful one, and the page shows every one
            let name = c.name("name").map_or("", |m| m.as_str());
            return Some(make(&c, Some("error"), &format!("Traceback: in {name}")));
        }
        if let Some(c) = COLON.captures(line) {
            // Only lines that name a severity, or a source file, are places; "12:30:05: started" is a time
            let file = c["file"].to_lowercase();
            let source = [".rs", ".go", ".c", ".cc", ".cpp", ".h", ".hpp", ".java", ".kt", ".ts", ".tsx", ".js", ".jsx", ".py", ".swift", ".cs", ".rb", ".php", ".dart", ".ex", ".zig"].iter().any(|e| file.ends_with(e));
            if c.name("sev").is_some() || source {
                return Some(make(&c, c.name("sev").map(|m| m.as_str()), &c["msg"]));
            }
        }
        None
    }
}

/// The ports a line says something is listening on, and whether the address is open to the whole network
pub fn ports_in(raw: &str) -> Vec<(u16, bool)> {
    static ADDR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(?P<host>localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\d{1,3}(?:\.\d{1,3}){3}):(?P<port>\d{2,5})\b").unwrap());
    let text = strip_ansi(raw);
    ADDR.captures_iter(&text)
        .filter_map(|c| {
            let port: u16 = c["port"].parse().ok()?;
            let host = c["host"].to_lowercase();
            // Open to the network: every address, or one that is not this machine's own
            let open = !(host == "localhost" || host == "127.0.0.1" || host == "[::1]");
            (port >= 80).then_some((port, open))
        })
        .collect()
}

// ────────────────────────────
// Running
// ────────────────────────────

/// Runs in progress, each with the switch that stops it
#[derive(Default)]
pub struct TaskState {
    runs: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Output<'a> {
    run_id: &'a str,
    project: &'a str,
    task: &'a str,
    stream: &'static str,
    text: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Exit<'a> {
    run_id: &'a str,
    project: &'a str,
    task: &'a str,
    code: Option<i32>,
    stopped: bool,
    restarts: u32,
    error: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Whether something is accepting connections on a local port
fn listening(port: u16) -> bool {
    [format!("127.0.0.1:{port}"), format!("[::1]:{port}")]
        .iter()
        .filter_map(|a| a.parse().ok())
        .any(|a| std::net::TcpStream::connect_timeout(&a, Duration::from_millis(200)).is_ok())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub run_id: String,
    pub project: String,
    pub task: String,
    pub started: u64,
    pub duration_ms: u64,
    pub code: Option<i32>,
    pub stopped: bool,
    pub restarts: u32,
}

fn runs_file(workspace: &str) -> PathBuf {
    Path::new(workspace).join(".nexsync").join("project-runs.json")
}

fn load_runs(workspace: &str) -> Vec<RunRecord> {
    fs::read_to_string(runs_file(workspace)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Adds a run to the history kept on this device with its log, and forgets the oldest past a limit
fn record_run(workspace: &str, record: RunRecord, log: &[String]) {
    let dir = Path::new(workspace).join(".nexsync").join("runs");
    let _ = fs::create_dir_all(&dir);
    let _ = fs::write(dir.join(format!("{}.log", record.run_id)), log.join("\n"));
    let mut all = load_runs(workspace);
    all.insert(0, record);
    for old in all.split_off(all.len().min(KEEP_RUNS)) {
        let _ = fs::remove_file(dir.join(format!("{}.log", old.run_id)));
    }
    if let Ok(text) = serde_json::to_string(&all) {
        let _ = fs::write(runs_file(workspace), text);
    }
}

#[tauri::command]
pub fn project_runs(app_handle: AppHandle, path: String, project: String) -> Result<Vec<RunRecord>, String> {
    validate_allowed_root(&app_handle, &path)?;
    Ok(load_runs(&path).into_iter().filter(|r| r.project == project).collect())
}

/// The saved output of one finished run
#[tauri::command]
pub fn project_run_log(app_handle: AppHandle, path: String, run_id: String) -> Result<String, String> {
    validate_allowed_root(&app_handle, &path)?;
    if run_id.is_empty() || !run_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("That is not a run.".to_string());
    }
    fs::read_to_string(Path::new(&path).join(".nexsync").join("runs").join(format!("{run_id}.log"))).map_err(|_| "That run's output was not kept.".to_string())
}

/// What the page needs to say about a run as it prints
struct Watch {
    app: AppHandle,
    run_id: String,
    project: String,
    task: String,
    ready_text: Option<String>,
    ready: bool,
    ports: HashSet<u16>,
    problems: Problems,
    log: Vec<String>,
}

impl Watch {
    fn line(&mut self, stream: &'static str, text: String) {
        let plain = strip_ansi(&text);
        if self.log.len() < MAX_LOG_LINES {
            self.log.push(plain.clone());
        }
        let _ = self.app.emit(EVENT_OUTPUT, Output { run_id: &self.run_id, project: &self.project, task: &self.task, stream, text });
        if !self.ready && self.ready_text.as_ref().is_some_and(|t| plain.to_lowercase().contains(t)) {
            self.ready = true;
            let _ = self.app.emit(EVENT_READY, serde_json::json!({ "runId": self.run_id, "project": self.project, "task": self.task }));
        }
        for (port, open) in ports_in(&plain) {
            if self.ports.insert(port) {
                let _ = self.app.emit(EVENT_PORT, serde_json::json!({ "runId": self.run_id, "project": self.project, "port": port, "open": open }));
            }
        }
        if let Some(p) = self.problems.feed(&plain) {
            let _ = self.app.emit(EVENT_PROBLEM, serde_json::json!({ "runId": self.run_id, "project": self.project, "task": self.task, "problem": p }));
        }
    }
}

/// Starts a task and returns the id of the run. It needs the approval described at the top, or `once` (the person chose Run Once
/// in the dialog a moment ago).
#[tauri::command]
pub async fn project_task_start(app: AppHandle, state: State<'_, TaskState>, path: String, project: String, task_id: String, once: bool) -> Result<String, String> {
    validate_allowed_root(&app, &path)?;
    let (dir, task) = find_task(&path, &project, &task_id)?;
    let mut trust = load_trust(&path);
    if !once && !trust.approved.contains(&fingerprint(&project, &task)) {
        return Err("This command has not been approved on this device.".to_string());
    }
    trust.last.insert(format!("{project}/{task_id}"), task.command.clone());
    let _ = save_trust(&path, &trust);

    for port in &task.ports {
        if task.watch && listening(*port) {
            return Err(format!("Port {port} is already in use by another program. Stop that program first, or change the port in the recipe."));
        }
    }
    let cwd = if task.cwd.is_empty() { dir.clone() } else { dir.join(&task.cwd) };
    if !cwd.is_dir() {
        return Err(format!("The folder \"{}\" does not exist in this project.", task.cwd));
    }
    let env = project_env::values_for(&path, &project);

    let run_id = uuid::Uuid::new_v4().to_string();
    let (stop_tx, mut stop_rx) = oneshot::channel();
    state.runs.lock().unwrap_or_else(|p| p.into_inner()).insert(run_id.clone(), stop_tx);

    // A task that keeps running is ready when its text appears, or its port accepts connections, or it has run a moment
    let ready_text = Some(task.ready_when.trim().to_lowercase()).filter(|t| !t.is_empty() && !t.chars().all(|c| c.is_ascii_digit()));
    let ready_ports: Vec<u16> = if task.ready_when.trim().parse::<u16>().is_ok() { vec![task.ready_when.trim().parse().unwrap_or(0)] } else if ready_text.is_none() { task.ports.clone() } else { Vec::new() };
    let watch = Arc::new(Mutex::new(Watch { app: app.clone(), run_id: run_id.clone(), project: project.clone(), task: task_id.clone(), ready_text, ready: false, ports: HashSet::new(), problems: Problems::default(), log: Vec::new() }));
    if task.watch {
        let (app, watch, run_id, project, task_id) = (app.clone(), watch.clone(), run_id.clone(), project.clone(), task_id.clone());
        let needs_poll = !ready_ports.is_empty();
        tokio::spawn(async move {
            let started = Instant::now();
            loop {
                tokio::time::sleep(Duration::from_millis(if needs_poll { 500 } else { 1500 })).await;
                let mut w = watch.lock().unwrap_or_else(|p| p.into_inner());
                if w.ready {
                    return;
                }
                let up = if needs_poll { ready_ports.iter().any(|p| listening(*p)) } else { w.ready_text.is_none() };
                if up || started.elapsed() > READY_WAIT {
                    w.ready = true;
                    let _ = app.emit(EVENT_READY, serde_json::json!({ "runId": run_id, "project": project, "task": task_id }));
                    return;
                }
            }
        });
    }

    let (ws, wid, proj, tid, command, restarts_allowed) = (path.clone(), run_id.clone(), project.clone(), task_id.clone(), task.command.clone(), task.watch);
    let emitter = app.clone();
    let started_at = now_ms();
    tokio::spawn(async move {
        let sink: Sink = {
            let watch = watch.clone();
            Arc::new(move |stream, text| watch.lock().unwrap_or_else(|p| p.into_inner()).line(stream, text))
        };
        let begun = Instant::now();
        let mut restarts = 0u32;
        let (code, stopped, error) = loop {
            let result = run_streaming(&cwd, &command, &env, &mut stop_rx, sink.clone()).await;
            let (code, stopped, error) = match result {
                Ok((code, stopped)) => (code, stopped, None),
                Err(e) => (None, false, Some(e)),
            };
            // A server that falls over is started again, a few times, so a typo saved mid-edit does not end the session
            if restarts_allowed && !stopped && error.is_none() && code != Some(0) && restarts < MAX_RESTARTS {
                restarts += 1;
                sink("stderr", format!("[Stopped unexpectedly: starting again ({restarts} of {MAX_RESTARTS})]"));
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(2)) => continue,
                    _ = &mut stop_rx => break (None, true, None),
                }
            }
            break (code, stopped, error);
        };
        if let Some(e) = &error {
            sink("stderr", e.clone());
        }
        let _ = emitter.emit(EVENT_EXIT, Exit { run_id: &wid, project: &proj, task: &tid, code, stopped, restarts, error });
        let log = watch.lock().unwrap_or_else(|p| p.into_inner()).log.clone();
        record_run(&ws, RunRecord { run_id: wid.clone(), project: proj.clone(), task: tid.clone(), started: started_at, duration_ms: begun.elapsed().as_millis() as u64, code, stopped, restarts }, &log);
        if tid == "install" && code == Some(0) {
            project_env::mark_installed(&ws, &proj);
        }
        if let Some(s) = emitter.try_state::<TaskState>() {
            s.runs.lock().unwrap_or_else(|p| p.into_inner()).remove(&wid);
        }
    });
    Ok(run_id)
}

/// Stops a run; does nothing if it already ended
#[tauri::command]
pub fn project_task_stop(state: State<'_, TaskState>, run_id: String) {
    if let Some(tx) = state.runs.lock().unwrap_or_else(|p| p.into_inner()).remove(&run_id) {
        let _ = tx.send(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(command: &str) -> TaskSpec {
        TaskSpec { id: "dev".into(), label: "Dev".into(), command: command.into(), ..Default::default() }
    }

    #[test]
    fn any_change_to_a_task_asks_again() {
        let base = fingerprint("app", &task("npm run dev"));
        assert_eq!(base, fingerprint("app", &task("npm run dev")));
        assert_ne!(base, fingerprint("app", &task("npm run dev -- --host")));
        assert_ne!(base, fingerprint("other", &task("npm run dev")));
        assert_ne!(base, fingerprint("app", &TaskSpec { cwd: "web".into(), ..task("npm run dev") }));
        assert_ne!(base, fingerprint("app", &TaskSpec { env: vec!["TOKEN".into()], ..task("npm run dev") }));
        assert_eq!(fingerprint("app", &TaskSpec { env: vec!["A".into(), "B".into()], ..task("x") }), fingerprint("app", &TaskSpec { env: vec!["B".into(), "A".into()], ..task("x") }));
    }

    fn found(lines: &[&str]) -> Vec<Problem> {
        let mut p = Problems::default();
        lines.iter().filter_map(|l| p.feed(l)).collect()
    }

    fn at(file: &str, line: u32, column: u32, severity: &str, message: &str) -> Problem {
        Problem { file: file.into(), line, column, severity: severity.into(), message: message.into() }
    }

    #[test]
    fn problems_are_read_from_what_compilers_print() {
        assert_eq!(found(&["src/app.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'."]), [at("src/app.ts", 12, 5, "error", "Type 'string' is not assignable to type 'number'.")]);
        assert_eq!(found(&["Program.cs(7,13): warning CS0168: The variable 'e' is declared but never used"]), [at("Program.cs", 7, 13, "warning", "The variable 'e' is declared but never used")]);
        assert_eq!(found(&["main.c:10:3: error: expected ';' before 'return'"]), [at("main.c", 10, 3, "error", "expected ';' before 'return'")]);
        assert_eq!(found(&["./server.go:21:2: undefined: handler"]), [at("./server.go", 21, 2, "error", "undefined: handler")]);
        assert_eq!(found(&["error[E0425]: cannot find value `x` in this scope", "  --> src/main.rs:3:5", "   |"]), [at("src/main.rs", 3, 5, "error", "cannot find value `x` in this scope")]);
        assert_eq!(found(&["[ERROR] C:\\w\\src\\A.java:[12,5] cannot find symbol"]), [at("C:/w/src/A.java", 12, 5, "error", "cannot find symbol")]);
        assert_eq!(found(&["\u{1b}[31msrc/a.ts(1,1): error TS1: bad\u{1b}[0m"]), [at("src/a.ts", 1, 1, "error", "bad")]);
        assert_eq!(found(&["  File \"app.py\", line 12, in main"]), [at("app.py", 12, 0, "error", "Traceback: in main")]);
    }

    #[test]
    fn ordinary_output_is_not_a_problem() {
        assert!(found(&["12:30:05: server started", "Compiled successfully in 3.2s", "  --> not a place", "warning: unused", "listening on http://localhost:3000"]).is_empty());
    }

    #[test]
    fn ports_and_their_exposure_are_read_from_output() {
        assert_eq!(ports_in("  Local:   http://localhost:5173/"), [(5173, false)]);
        assert_eq!(ports_in("Server running at http://0.0.0.0:8000"), [(8000, true)]);
        assert_eq!(ports_in("  Network: http://192.168.1.20:3000/"), [(3000, true)]);
        assert_eq!(ports_in("\u{1b}[36mhttp://127.0.0.1:4321\u{1b}[0m"), [(4321, false)]);
        assert!(ports_in("took 12:30 to build").is_empty());
    }

    #[tokio::test]
    async fn a_task_runs_with_its_environment_and_the_history_keeps_it() {
        let dir = std::env::temp_dir().join(format!("nexsync-task-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let store = lines.clone();
        let sink: Sink = Arc::new(move |_, text| store.lock().unwrap().push(text));
        let (_tx, mut rx) = oneshot::channel();
        #[cfg(windows)]
        let command = "echo %NEXSYNC_TEST_VALUE%";
        #[cfg(not(windows))]
        let command = "echo $NEXSYNC_TEST_VALUE";
        let (code, _) = run_streaming(&dir, command, &[("NEXSYNC_TEST_VALUE".into(), "from the project".into())], &mut rx, sink).await.unwrap();
        assert_eq!(code, Some(0));
        assert!(lines.lock().unwrap().iter().any(|l| l.trim() == "from the project"));

        let w = dir.to_str().unwrap();
        for i in 0..KEEP_RUNS + 2 {
            record_run(w, RunRecord { run_id: format!("{i:032x}"), project: "app".into(), task: "test".into(), started: i as u64, duration_ms: 1, code: Some(0), stopped: false, restarts: 0 }, &["line".to_string()]);
        }
        let kept = load_runs(w);
        assert_eq!(kept.len(), KEEP_RUNS);
        assert_eq!(kept[0].started, (KEEP_RUNS + 1) as u64, "newest first");
        assert!(!dir.join(".nexsync/runs").join(format!("{:032x}.log", 0)).exists(), "the oldest log is gone with its record");
        let _ = fs::remove_dir_all(dir);
    }
}
