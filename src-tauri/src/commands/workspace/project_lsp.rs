//! Language intelligence (Phase 20, step 9): a Language Server Protocol client. A language server that is installed on this device
//! (TypeScript, rust-analyzer, Pyright, gopls, clangd, Intelephense) is started for a project and gives the editor diagnostics,
//! hover, go to definition and completion.
//!
//! What keeps this safe and honest:
//! - **Off until this device's owner turns it on, per project.** A language server can run code from the project (rust-analyzer
//!   runs build scripts and procedural macros, the TypeScript server loads plugins named in `tsconfig.json`), and the project's
//!   files come from other people. So nothing starts until the person says so, and the choice is kept only on this device
//!   (`.nexsync/project-lsp.json`).
//! - **Only programs from a fixed table, found on the PATH.** A project cannot name a server, and a copy inside the project
//!   folder (`node_modules/.bin`) is never used.
//! - **Per device.** A server's state is not shared; each person's editor talks to their own.
//! - The text a server sees for an open file is the live shared text, so it analyses what is on screen and not what was last saved.
//!
//! Not built: rename and find references across files (they need the edits applied to shared documents), Java and C# servers (their
//! launch lines are long and per-install), and formatting through a server (Prettier and the editor's own format stay).

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicI64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{mpsc, oneshot},
};

use super::projects::project_dir;
use crate::commands::config::validate_allowed_root;

pub const EVENT_DIAGNOSTICS: &str = "lsp://diagnostics";
pub const EVENT_STATE: &str = "lsp://state";
const START_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_DOC_BYTES: usize = 2 * 1024 * 1024;
const MAX_DIAGNOSTICS: usize = 500;

// ────────────────────────────
// The protocol
// ────────────────────────────

/// Called with the method and parameters of each notification the server sends
pub type Notify = Arc<dyn Fn(&str, Value) + Send + Sync>;
type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>>;

/// A running language server, spoken to over its standard input and output
pub struct Client {
    tx: mpsc::UnboundedSender<Value>,
    pending: Pending,
    next: AtomicI64,
    alive: Arc<AtomicBool>,
    child: Arc<tokio::sync::Mutex<Option<tokio::process::Child>>>,
}

/// One message: `Content-Length: n`, a blank line, n bytes of JSON
pub async fn read_frame<R: tokio::io::AsyncRead + Unpin>(r: &mut BufReader<R>) -> Option<Value> {
    let mut length: Option<usize> = None;
    loop {
        let mut line = String::new();
        if r.read_line(&mut line).await.ok()? == 0 {
            return None;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            length = v.trim().parse().ok();
        }
    }
    let n = length.filter(|n| *n <= 64 * 1024 * 1024)?;
    let mut body = vec![0u8; n];
    r.read_exact(&mut body).await.ok()?;
    serde_json::from_slice(&body).ok()
}

pub fn frame(message: &Value) -> Vec<u8> {
    let body = serde_json::to_vec(message).unwrap_or_default();
    let mut out = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    out.extend(body);
    out
}

impl Client {
    pub fn start(program: &Path, args: &[&str], cwd: &Path, notify: Notify) -> Result<Client, String> {
        let mut command = Command::new(program);
        command.args(args).current_dir(cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        let mut child = command.spawn().map_err(|e| format!("The language server did not start: {e}"))?;
        let (mut stdin, stdout) = (child.stdin.take().ok_or("no input")?, child.stdout.take().ok_or("no output")?);
        let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
        let pending: Pending = Arc::default();
        let alive = Arc::new(AtomicBool::new(true));

        tokio::spawn(async move {
            while let Some(m) = rx.recv().await {
                if stdin.write_all(&frame(&m)).await.is_err() || stdin.flush().await.is_err() {
                    return;
                }
            }
        });

        let (reply, pending2, alive2) = (tx.clone(), pending.clone(), alive.clone());
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            while let Some(m) = read_frame(&mut reader).await {
                let method = m.get("method").and_then(Value::as_str);
                let id = m.get("id").cloned().filter(|i| !i.is_null());
                match (method, id) {
                    // The answer to one of our requests
                    (None, Some(id)) => {
                        if let Some(n) = id.as_i64() {
                            if let Some(waiting) = pending2.lock().unwrap_or_else(|p| p.into_inner()).remove(&n) {
                                let _ = waiting.send(match m.get("error") {
                                    Some(e) => Err(e.get("message").and_then(Value::as_str).unwrap_or("the server reported an error").to_string()),
                                    None => Ok(m.get("result").cloned().unwrap_or(Value::Null)),
                                });
                            }
                        }
                    }
                    // A request from the server: most only want an answer so they can go on
                    (Some(method), Some(id)) => {
                        let result = match method {
                            "workspace/configuration" => {
                                let n = m.pointer("/params/items").and_then(Value::as_array).map_or(0, Vec::len);
                                json!(vec![Value::Null; n])
                            }
                            "client/registerCapability" | "client/unregisterCapability" | "window/workDoneProgress/create" | "window/showMessageRequest" => Value::Null,
                            "workspace/workspaceFolders" => Value::Null,
                            _ => {
                                let _ = reply.send(json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": "not supported"}}));
                                continue;
                            }
                        };
                        let _ = reply.send(json!({"jsonrpc": "2.0", "id": id, "result": result}));
                    }
                    (Some(method), None) => notify(method, m.get("params").cloned().unwrap_or(Value::Null)),
                    _ => {}
                }
            }
            // The server ended: nobody is going to answer what is still waiting
            alive2.store(false, Ordering::SeqCst);
            for (_, waiting) in pending2.lock().unwrap_or_else(|p| p.into_inner()).drain() {
                let _ = waiting.send(Err("The language server stopped.".to_string()));
            }
        });

        Ok(Client { tx, pending, next: AtomicI64::new(1), alive, child: Arc::new(tokio::sync::Mutex::new(Some(child))) })
    }

    pub fn alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    pub async fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        if !self.alive() {
            return Err("The language server stopped.".to_string());
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (done, wait) = oneshot::channel();
        self.pending.lock().unwrap_or_else(|p| p.into_inner()).insert(id, done);
        if self.tx.send(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})).is_err() {
            self.pending.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
            return Err("The language server stopped.".to_string());
        }
        match tokio::time::timeout(timeout, wait).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err("The language server stopped.".to_string()),
            Err(_) => {
                self.pending.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
                Err("The language server did not answer in time.".to_string())
            }
        }
    }

    pub fn notify(&self, method: &str, params: Value) {
        let _ = self.tx.send(json!({"jsonrpc": "2.0", "method": method, "params": params}));
    }

    /// Asks the server to end, and ends it if it does not
    pub async fn shutdown(&self) {
        if self.alive() {
            let _ = self.request("shutdown", Value::Null, Duration::from_secs(3)).await;
            self.notify("exit", Value::Null);
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
        }
        self.alive.store(false, Ordering::SeqCst);
    }
}

// ────────────────────────────
// Addresses
// ────────────────────────────

fn encode(segment: &str) -> String {
    let mut out = String::new();
    for b in segment.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~' | b'/') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// `file:///c%3A/Users/x/a.ts`-style address of a path (a drive letter keeps its colon encoded, as editors write it)
pub fn to_uri(path: &Path) -> String {
    let p = path.to_string_lossy().replace('\\', "/");
    let p = p.trim_start_matches("//?/");
    let (drive, rest) = match p.as_bytes() {
        [d, b':', ..] if d.is_ascii_alphabetic() => (Some(*d as char), &p[2..]),
        _ => (None, p),
    };
    match drive {
        Some(d) => format!("file:///{}%3A{}", d.to_ascii_lowercase(), encode(rest)),
        None => format!("file://{}", encode(rest)),
    }
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The path an address names, or `None` for anything that is not a file address
pub fn from_uri(uri: &str) -> Option<PathBuf> {
    let rest = uri.strip_prefix("file://")?;
    let p = decode(rest);
    // `/c:/x` on Windows
    let p = match p.as_bytes() {
        [b'/', d, b':', ..] if d.is_ascii_alphabetic() => p[1..].to_string(),
        _ => p,
    };
    Some(PathBuf::from(p))
}

/// The path of `file` inside `project_dir` (with `/`), or `None` when it is elsewhere. Case does not matter on Windows.
pub fn rel_in(project_dir: &Path, file: &Path) -> Option<String> {
    let norm = |p: &Path| p.to_string_lossy().replace('\\', "/").trim_start_matches("//?/").trim_end_matches('/').to_string();
    let (root, f) = (norm(project_dir), norm(file));
    let (rl, fl) = if cfg!(windows) { (root.to_lowercase(), f.to_lowercase()) } else { (root.clone(), f.clone()) };
    fl.strip_prefix(&format!("{rl}/")).map(|_| f[root.len() + 1..].to_string())
}

// ────────────────────────────
// The servers
// ────────────────────────────

struct Server {
    id: &'static str,
    label: &'static str,
    programs: &'static [&'static str],
    args: &'static [&'static str],
    /// Extensions it handles, with the language id the protocol wants for each
    exts: &'static [(&'static str, &'static str)],
    /// Files that mark the root of a project for this server
    markers: &'static [&'static str],
    url: &'static str,
}

const SERVERS: &[Server] = &[
    Server {
        id: "typescript",
        label: "TypeScript and JavaScript",
        programs: &["typescript-language-server"],
        args: &["--stdio"],
        exts: &[("ts", "typescript"), ("tsx", "typescriptreact"), ("mts", "typescript"), ("cts", "typescript"), ("js", "javascript"), ("jsx", "javascriptreact"), ("mjs", "javascript"), ("cjs", "javascript")],
        markers: &["tsconfig.json", "jsconfig.json", "package.json"],
        url: "https://github.com/typescript-language-server/typescript-language-server#installing",
    },
    Server { id: "rust", label: "Rust", programs: &["rust-analyzer"], args: &[], exts: &[("rs", "rust")], markers: &["Cargo.toml"], url: "https://rust-analyzer.github.io/book/installation.html" },
    Server { id: "python", label: "Python", programs: &["pyright-langserver"], args: &["--stdio"], exts: &[("py", "python"), ("pyi", "python")], markers: &["pyproject.toml", "pyrightconfig.json", "setup.py", "requirements.txt"], url: "https://microsoft.github.io/pyright/#/installation" },
    Server { id: "go", label: "Go", programs: &["gopls"], args: &[], exts: &[("go", "go")], markers: &["go.mod", "go.work"], url: "https://pkg.go.dev/golang.org/x/tools/gopls#readme-installation" },
    Server {
        id: "clangd",
        label: "C and C++",
        programs: &["clangd"],
        args: &[],
        exts: &[("c", "c"), ("h", "c"), ("cc", "cpp"), ("cpp", "cpp"), ("cxx", "cpp"), ("hpp", "cpp"), ("hh", "cpp")],
        markers: &["compile_commands.json", "CMakeLists.txt", ".clangd"],
        url: "https://clangd.llvm.org/installation",
    },
    Server { id: "php", label: "PHP", programs: &["intelephense"], args: &["--stdio"], exts: &[("php", "php")], markers: &["composer.json"], url: "https://intelephense.com/" },
];

fn server_for(rel: &str) -> Option<(&'static Server, &'static str)> {
    let ext = rel.rsplit('.').next()?.to_ascii_lowercase();
    SERVERS.iter().find_map(|s| s.exts.iter().find(|(e, _)| *e == ext).map(|(_, lang)| (s, *lang)))
}

/// A program on the PATH (with the extensions Windows adds); never one inside a project
pub fn find_on_path(name: &str) -> Option<PathBuf> {
    let exts: Vec<String> = if cfg!(windows) { std::env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.CMD;.BAT".into()).split(';').map(str::to_lowercase).collect() } else { vec![String::new()] };
    std::env::split_paths(&std::env::var_os("PATH")?).find_map(|dir| {
        exts.iter().map(|e| dir.join(format!("{name}{e}"))).find(|p| p.is_file())
    })
}

/// The folder a server should treat as the root for a file: the nearest one up to the project that holds a marker
fn root_for(project_dir: &Path, rel: &str, server: &Server) -> PathBuf {
    let mut dir = project_dir.join(rel);
    dir.pop();
    while dir.starts_with(project_dir) {
        if server.markers.iter().any(|m| dir.join(m).exists()) {
            return dir;
        }
        if !dir.pop() {
            break;
        }
    }
    project_dir.to_path_buf()
}

// ────────────────────────────
// The choice, kept on this device
// ────────────────────────────

fn choice_file(workspace: &str) -> PathBuf {
    Path::new(workspace).join(".nexsync").join("project-lsp.json")
}

fn enabled(workspace: &str, project: &str) -> bool {
    std::fs::read_to_string(choice_file(workspace)).ok().and_then(|t| serde_json::from_str::<HashMap<String, bool>>(&t).ok()).is_some_and(|m| m.get(project).copied().unwrap_or(false))
}

fn set_enabled(workspace: &str, project: &str, on: bool) -> Result<(), String> {
    let mut m: HashMap<String, bool> = std::fs::read_to_string(choice_file(workspace)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    if on {
        m.insert(project.to_string(), true);
    } else {
        m.remove(project);
    }
    std::fs::create_dir_all(Path::new(workspace).join(".nexsync")).map_err(|e| e.to_string())?;
    std::fs::write(choice_file(workspace), serde_json::to_string(&m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

// ────────────────────────────
// Running servers
// ────────────────────────────

struct Instance {
    client: Client,
    label: &'static str,
    /// Version of each open document, by address
    open: Mutex<HashMap<String, i64>>,
}

#[derive(Default)]
pub struct LspState {
    instances: tokio::sync::Mutex<HashMap<String, Arc<Instance>>>,
}

impl LspState {
    /// Ends every server; called when the app closes
    pub async fn stop_all(&self) {
        let all: Vec<_> = self.instances.lock().await.drain().map(|(_, i)| i).collect();
        for i in all {
            i.client.shutdown().await;
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Diagnostics {
    project: String,
    /// Inside the project
    rel: String,
    server: &'static str,
    diagnostics: Vec<Value>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StateEvent {
    project: String,
    server: &'static str,
    state: &'static str,
    message: String,
}

fn capabilities() -> Value {
    json!({
        "textDocument": {
            "synchronization": {"dynamicRegistration": false, "didSave": false},
            "publishDiagnostics": {"relatedInformation": false},
            "hover": {"contentFormat": ["markdown", "plaintext"]},
            "completion": {"completionItem": {"snippetSupport": false, "documentationFormat": ["markdown", "plaintext"]}},
            "definition": {"linkSupport": false},
            "signatureHelp": {"signatureInformation": {"documentationFormat": ["markdown", "plaintext"]}},
            "documentSymbol": {"hierarchicalDocumentSymbolSupport": true}
        },
        "workspace": {"workspaceFolders": true, "configuration": true},
        "window": {"workDoneProgress": true}
    })
}

async fn instance(app: &AppHandle, state: &LspState, workspace: &str, project: &str, project_dir: &Path, server: &'static Server, root: &Path) -> Result<Arc<Instance>, String> {
    let key = format!("{workspace}|{project}|{}|{}", server.id, root.display());
    let mut all = state.instances.lock().await;
    if let Some(i) = all.get(&key) {
        if i.client.alive() {
            return Ok(i.clone());
        }
    }
    let program = server.programs.iter().find_map(|p| find_on_path(p)).ok_or_else(|| format!("{} is not installed on this device. {}", server.label, server.url))?;
    let (app2, project2, dir2) = (app.clone(), project.to_string(), project_dir.to_path_buf());
    let sid = server.id;
    let notify: Notify = Arc::new(move |method, params| {
        if method == "textDocument/publishDiagnostics" {
            let Some(file) = params.get("uri").and_then(Value::as_str).and_then(from_uri) else { return };
            let Some(rel) = rel_in(&dir2, &file) else { return };
            let mut diagnostics = params.get("diagnostics").and_then(Value::as_array).cloned().unwrap_or_default();
            diagnostics.truncate(MAX_DIAGNOSTICS);
            let _ = app2.emit(EVENT_DIAGNOSTICS, Diagnostics { project: project2.clone(), rel, server: sid, diagnostics });
        }
    });
    let _ = app.emit(EVENT_STATE, StateEvent { project: project.to_string(), server: server.id, state: "starting", message: String::new() });
    let client = Client::start(&program, server.args, root, notify)?;
    let uri = to_uri(root);
    let name = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "project".into());
    let init = client
        .request("initialize", json!({"processId": std::process::id(), "clientInfo": {"name": "Nexsync"}, "rootUri": uri, "workspaceFolders": [{"uri": uri, "name": name}], "capabilities": capabilities()}), START_TIMEOUT)
        .await;
    if let Err(e) = init {
        client.shutdown().await;
        let _ = app.emit(EVENT_STATE, StateEvent { project: project.to_string(), server: server.id, state: "failed", message: e.clone() });
        return Err(format!("{} did not start: {e}", server.label));
    }
    client.notify("initialized", json!({}));
    let _ = app.emit(EVENT_STATE, StateEvent { project: project.to_string(), server: server.id, state: "ready", message: String::new() });
    let i = Arc::new(Instance { client, label: server.label, open: Mutex::new(HashMap::new()) });
    all.insert(key, i.clone());
    Ok(i)
}

/// What the page needs to show before it asks to turn language intelligence on
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub installed: bool,
    pub url: &'static str,
    pub extensions: Vec<&'static str>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LspStatus {
    pub enabled: bool,
    pub servers: Vec<ServerInfo>,
}

pub fn status_of(workspace: &str, project: &str) -> LspStatus {
    LspStatus {
        enabled: enabled(workspace, project),
        servers: SERVERS.iter().map(|s| ServerInfo { id: s.id, label: s.label, installed: s.programs.iter().any(|p| find_on_path(p).is_some()), url: s.url, extensions: s.exts.iter().map(|(e, _)| *e).collect() }).collect(),
    }
}

fn checked_rel(rel: &str) -> Result<(), String> {
    if rel.is_empty() || rel.starts_with('/') || rel.contains('\\') || rel.split('/').any(|p| p.is_empty() || p == ".." || p == ".") {
        return Err("That is not a file of this project.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_status(app: AppHandle, path: String, project: String) -> Result<LspStatus, String> {
    validate_allowed_root(&app, &path)?;
    project_dir(&path, &project)?;
    tokio::task::spawn_blocking(move || status_of(&path, &project)).await.map_err(|e| e.to_string())
}

/// Turns language intelligence on or off for a project on this device; off ends its servers
#[tauri::command]
pub async fn lsp_enable(app: AppHandle, state: State<'_, LspState>, path: String, project: String, on: bool) -> Result<(), String> {
    validate_allowed_root(&app, &path)?;
    project_dir(&path, &project)?;
    set_enabled(&path, &project, on)?;
    if !on {
        let prefix = format!("{path}|{project}|");
        let gone: Vec<_> = {
            let mut all = state.instances.lock().await;
            let keys: Vec<String> = all.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
            keys.into_iter().filter_map(|k| all.remove(&k)).collect()
        };
        for i in gone {
            i.client.shutdown().await;
        }
    }
    Ok(())
}

/// Tells the server the text of an open file (opening it the first time). Returns the server's name, or `None` when no server
/// handles the file or none is installed.
#[tauri::command]
pub async fn lsp_sync(app: AppHandle, state: State<'_, LspState>, path: String, project: String, rel: String, text: String, version: i64) -> Result<Option<String>, String> {
    validate_allowed_root(&app, &path)?;
    let dir = project_dir(&path, &project)?;
    checked_rel(&rel)?;
    if text.len() > MAX_DOC_BYTES {
        return Ok(None);
    }
    let Some((server, language)) = server_for(&rel) else { return Ok(None) };
    if !server.programs.iter().any(|p| find_on_path(p).is_some()) {
        return Ok(None);
    }
    if !enabled(&path, &project) {
        return Err("Language intelligence is off for this project on this device.".to_string());
    }
    let root = root_for(&dir, &rel, server);
    let inst = instance(&app, &state, &path, &project, &dir, server, &root).await?;
    let uri = to_uri(&dir.join(&rel));
    let known = inst.open.lock().unwrap_or_else(|p| p.into_inner()).insert(uri.clone(), version).is_some();
    if known {
        inst.client.notify("textDocument/didChange", json!({"textDocument": {"uri": uri, "version": version}, "contentChanges": [{"text": text}]}));
    } else {
        inst.client.notify("textDocument/didOpen", json!({"textDocument": {"uri": uri, "languageId": language, "version": version, "text": text}}));
    }
    Ok(Some(inst.label.to_string()))
}

#[tauri::command]
pub async fn lsp_close(app: AppHandle, state: State<'_, LspState>, path: String, project: String, rel: String) -> Result<(), String> {
    validate_allowed_root(&app, &path)?;
    let dir = project_dir(&path, &project)?;
    checked_rel(&rel)?;
    let uri = to_uri(&dir.join(&rel));
    let all: Vec<_> = state.instances.lock().await.values().cloned().collect();
    for i in all {
        if i.open.lock().unwrap_or_else(|p| p.into_inner()).remove(&uri).is_some() {
            i.client.notify("textDocument/didClose", json!({"textDocument": {"uri": uri}}));
        }
    }
    Ok(())
}

const REQUESTS: &[&str] = &[
    "textDocument/hover",
    "textDocument/definition",
    "textDocument/typeDefinition",
    "textDocument/implementation",
    "textDocument/completion",
    "textDocument/signatureHelp",
    "textDocument/documentHighlight",
    "textDocument/documentSymbol",
];

/// Adds `rel` (the path inside the project) next to every address in an answer that names a file of the project, so the page can
/// open it; an address elsewhere (a library's declarations) gets none
pub fn annotate(project_dir: &Path, v: &mut Value) {
    match v {
        Value::Array(a) => a.iter_mut().for_each(|x| annotate(project_dir, x)),
        Value::Object(o) => {
            let rel = ["uri", "targetUri"].iter().find_map(|k| o.get(*k).and_then(Value::as_str)).and_then(from_uri).and_then(|f| rel_in(project_dir, &f));
            if let Some(rel) = rel {
                o.insert("rel".to_string(), Value::String(rel));
            }
        }
        _ => {}
    }
}

/// One question to the server about an open file: the method is one of a fixed list, and the file's address is put in by us
#[tauri::command]
pub async fn lsp_request(app: AppHandle, state: State<'_, LspState>, path: String, project: String, rel: String, method: String, params: Value) -> Result<Value, String> {
    validate_allowed_root(&app, &path)?;
    let dir = project_dir(&path, &project)?;
    checked_rel(&rel)?;
    if !REQUESTS.contains(&method.as_str()) {
        return Err("That request is not one Nexsync makes.".to_string());
    }
    let uri = to_uri(&dir.join(&rel));
    let inst = {
        let all = state.instances.lock().await;
        all.values().find(|i| i.open.lock().unwrap_or_else(|p| p.into_inner()).contains_key(&uri) && i.client.alive()).cloned()
    }
    .ok_or("That file is not open in a language server.")?;
    let mut params = params;
    params.as_object_mut().ok_or("bad parameters")?.insert("textDocument".to_string(), json!({"uri": uri}));
    let timeout = if method.ends_with("completion") { Duration::from_secs(8) } else { Duration::from_secs(15) };
    let mut answer = inst.client.request(&method, params, timeout).await?;
    if matches!(method.as_str(), "textDocument/definition" | "textDocument/typeDefinition" | "textDocument/implementation") {
        annotate(&dir, &mut answer);
    }
    Ok(answer)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny server written in Node: it answers the handshake and hover, publishes a problem when a file is opened, asks the
    /// client for its configuration, and exits when asked to crash
    const FAKE: &str = r#"
let buf = Buffer.alloc(0);
function send(o) { const s = JSON.stringify(o); process.stdout.write('Content-Length: ' + Buffer.byteLength(s) + '\r\n\r\n' + s); }
function handle(m) {
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { capabilities: { hoverProvider: true } } });
  else if (m.method === 'textDocument/didOpen') {
    send({ jsonrpc: '2.0', id: 900, method: 'workspace/configuration', params: { items: [{ section: 'a' }, { section: 'b' }] } });
    send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: m.params.textDocument.uri, diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, severity: 1, message: 'bad ' + m.params.textDocument.text.length }] } });
  } else if (m.method === 'textDocument/hover') send({ jsonrpc: '2.0', id: m.id, result: { contents: 'hover at ' + m.params.position.line } });
  else if (m.method === 'boom') process.exit(1);
  else if (m.method === 'shutdown') send({ jsonrpc: '2.0', id: m.id, result: null });
  else if (m.method === 'exit') process.exit(0);
  else if (m.id === 900) send({ jsonrpc: '2.0', method: 'test/configAnswer', params: { result: m.result } });
}
process.stdin.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const i = buf.indexOf('\r\n\r\n');
    if (i < 0) return;
    const n = +/Content-Length: (\d+)/.exec(buf.slice(0, i).toString())[1];
    if (buf.length < i + 4 + n) return;
    const msg = JSON.parse(buf.slice(i + 4, i + 4 + n).toString());
    buf = buf.slice(i + 4 + n);
    handle(msg);
  }
});
"#;

    fn node() -> Option<PathBuf> {
        find_on_path("node")
    }

    #[test]
    fn addresses_round_trip_with_spaces_and_drive_letters() {
        let p = Path::new("E:\\MSC CS Material\\app\\src\\a b.ts");
        let uri = to_uri(p);
        assert_eq!(uri, "file:///e%3A/MSC%20CS%20Material/app/src/a%20b.ts");
        assert_eq!(from_uri(&uri).unwrap().to_string_lossy().replace('\\', "/"), "e:/MSC CS Material/app/src/a b.ts");
        assert_eq!(to_uri(Path::new("/home/x/a.rs")), "file:///home/x/a.rs");
        assert_eq!(from_uri("file:///home/x/a.rs").unwrap(), Path::new("/home/x/a.rs"));
        assert!(from_uri("https://example.com/a").is_none());
        // What a server sends back for a file inside the project
        let dir = Path::new("E:\\MSC CS Material\\app");
        assert_eq!(rel_in(dir, &from_uri("file:///e%3A/MSC%20CS%20Material/app/src/a%20b.ts").unwrap()).as_deref(), if cfg!(windows) { Some("src/a b.ts") } else { None });
        assert_eq!(rel_in(Path::new("/p/app"), Path::new("/p/app/src/a.ts")).as_deref(), Some("src/a.ts"));
        assert!(rel_in(Path::new("/p/app"), Path::new("/p/app2/a.ts")).is_none() && rel_in(Path::new("/p/app"), Path::new("/p/other/a.ts")).is_none());
    }

    #[test]
    fn places_in_the_project_are_marked_so_the_page_can_open_them() {
        let dir = Path::new("/p/app");
        let mut v = json!([{"uri": "file:///p/app/src/a.ts", "range": {}}, {"targetUri": "file:///p/app/b.ts"}, {"uri": "file:///p/app/node_modules/x.d.ts"}, {"uri": "file:///elsewhere/y.ts"}]);
        annotate(dir, &mut v);
        let rels: Vec<_> = v.as_array().unwrap().iter().map(|x| x.get("rel").and_then(Value::as_str).map(str::to_string)).collect();
        // Everything inside the folder is marked, even a dependency: the page decides what to open; only addresses outside get none
        assert_eq!(rels, [Some("src/a.ts".to_string()), Some("b.ts".to_string()), Some("node_modules/x.d.ts".to_string()), None]);
        let mut single = json!({"uri": "file:///p/app/c.ts"});
        annotate(dir, &mut single);
        assert_eq!(single["rel"], "c.ts");
    }

    #[test]
    fn a_file_picks_its_server_and_its_root() {
        assert_eq!(server_for("src/a.tsx").map(|(s, l)| (s.id, l)), Some(("typescript", "typescriptreact")));
        assert_eq!(server_for("lib/x.RS").map(|(s, _)| s.id), Some("rust"));
        assert!(server_for("README.md").is_none() && server_for("Makefile").is_none());
        let d = std::env::temp_dir().join(format!("nexsync-lsp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(d.join("packages/web/src")).unwrap();
        std::fs::write(d.join("packages/web/package.json"), "{}").unwrap();
        let (ts, _) = server_for("a.ts").unwrap();
        assert_eq!(root_for(&d, "packages/web/src/a.ts", ts), d.join("packages/web"));
        assert_eq!(root_for(&d, "tools/x.ts", ts), d);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn nothing_is_on_until_chosen_and_the_choice_is_per_project() {
        let ws = std::env::temp_dir().join(format!("nexsync-lsp-{}", uuid::Uuid::new_v4()));
        let w = ws.to_str().unwrap();
        assert!(!enabled(w, "app"));
        set_enabled(w, "app", true).unwrap();
        assert!(enabled(w, "app") && !enabled(w, "other"));
        set_enabled(w, "app", false).unwrap();
        assert!(!enabled(w, "app"));
        assert!(checked_rel("src/a.ts").is_ok() && checked_rel("../a.ts").is_err() && checked_rel("/etc/passwd").is_err() && checked_rel("a\\b").is_err());
        let _ = std::fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn a_server_is_started_asked_and_ended_and_a_crash_fails_what_is_waiting() {
        let Some(node) = node() else { return };
        let script = std::env::temp_dir().join(format!("nexsync-fake-lsp-{}.js", uuid::Uuid::new_v4()));
        std::fs::write(&script, FAKE).unwrap();
        let seen: Arc<Mutex<Vec<(String, Value)>>> = Arc::default();
        let sink = seen.clone();
        let client = Client::start(&node, &[script.to_str().unwrap()], &std::env::temp_dir(), Arc::new(move |m, p| sink.lock().unwrap().push((m.to_string(), p)))).unwrap();
        let init = client.request("initialize", json!({"capabilities": {}}), Duration::from_secs(10)).await.unwrap();
        assert_eq!(init["capabilities"]["hoverProvider"], true);
        client.notify("textDocument/didOpen", json!({"textDocument": {"uri": "file:///x/a.ts", "languageId": "typescript", "version": 1, "text": "let x"}}));
        let hover = client.request("textDocument/hover", json!({"position": {"line": 4, "character": 1}}), Duration::from_secs(10)).await.unwrap();
        assert_eq!(hover["contents"], "hover at 4");
        // The problem the server published and the answer to its question about configuration both reached us
        for _ in 0..50 {
            if seen.lock().unwrap().len() >= 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let got = seen.lock().unwrap().clone();
        let diag = got.iter().find(|(m, _)| m == "textDocument/publishDiagnostics").expect("diagnostics");
        assert_eq!(diag.1["diagnostics"][0]["message"], "bad 5");
        let cfg = got.iter().find(|(m, _)| m == "test/configAnswer").expect("configuration answer");
        assert_eq!(cfg.1["result"], json!([null, null]));
        // A server that dies fails the request that was waiting, and then every later one
        let boom = client.request("boom", Value::Null, Duration::from_secs(10)).await;
        assert!(boom.is_err());
        assert!(client.request("textDocument/hover", json!({}), Duration::from_secs(2)).await.is_err());
        client.shutdown().await;
        let _ = std::fs::remove_file(&script);
    }

    /// Against the real rust-analyzer, when it is installed: run by name (`cargo test real_rust_analyzer -- --ignored`)
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn real_rust_analyzer_reports_a_type_error_and_hovers() {
        // A rustup shim exists even when the component is not installed, so ask it
        let Some(program) = find_on_path("rust-analyzer").filter(|p| std::process::Command::new(p).arg("--version").output().is_ok_and(|o| o.status.success())) else { return };
        let dir = std::env::temp_dir().join(format!("nexsync-ra-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("Cargo.toml"), "[package]
name = \"probe\"
version = \"0.1.0\"
edition = \"2021\"
").unwrap();
        let text = "fn main() {
    let x: i32 = \"text\";
    println!(\"{}\", x);
}
";
        std::fs::write(dir.join("src/main.rs"), text).unwrap();
        let seen: Arc<Mutex<Vec<Value>>> = Arc::default();
        let sink = seen.clone();
        let client = Client::start(&program, &[], &dir, Arc::new(move |m, p| if m == "textDocument/publishDiagnostics" { sink.lock().unwrap().push(p) })).unwrap();
        let root = to_uri(&dir);
        client.request("initialize", json!({"processId": std::process::id(), "rootUri": root, "workspaceFolders": [{"uri": root, "name": "probe"}], "capabilities": capabilities()}), Duration::from_secs(60)).await.unwrap();
        client.notify("initialized", json!({}));
        let uri = to_uri(&dir.join("src/main.rs"));
        client.notify("textDocument/didOpen", json!({"textDocument": {"uri": uri, "languageId": "rust", "version": 1, "text": text}}));
        let mut message = String::new();
        for _ in 0..240 {
            if let Some(d) = seen.lock().unwrap().iter().flat_map(|p| p["diagnostics"].as_array().cloned().unwrap_or_default()).find(|d| d["severity"] == 1) {
                message = d["message"].as_str().unwrap_or("").to_string();
                break;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        let hover = client.request("textDocument/hover", json!({"textDocument": {"uri": uri}, "position": {"line": 2, "character": 24}}), Duration::from_secs(30)).await.unwrap();
        let def = client.request("textDocument/definition", json!({"textDocument": {"uri": uri}, "position": {"line": 2, "character": 24}}), Duration::from_secs(30)).await.unwrap();
        client.shutdown().await;
        let _ = std::fs::remove_dir_all(&dir);
        eprintln!("diagnostic: {message}
hover: {hover}
definition: {def}");
        assert!(message.contains("mismatched types"), "{message}");
        assert!(hover.to_string().contains("i32"));
        assert!(def.to_string().contains("main.rs"));
    }

    #[tokio::test]
    async fn a_request_that_is_never_answered_times_out() {
        let Some(node) = node() else { return };
        let script = std::env::temp_dir().join(format!("nexsync-fake-lsp-{}.js", uuid::Uuid::new_v4()));
        std::fs::write(&script, "setInterval(() => {}, 1000);").unwrap();
        let client = Client::start(&node, &[script.to_str().unwrap()], &std::env::temp_dir(), Arc::new(|_, _| {})).unwrap();
        let r = client.request("initialize", json!({}), Duration::from_millis(300)).await;
        assert_eq!(r.unwrap_err(), "The language server did not answer in time.");
        client.shutdown().await;
        let _ = std::fs::remove_file(&script);
    }
}
