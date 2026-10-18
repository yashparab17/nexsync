//! HTTP request files (Phase 20, ideas): `.http` and `.rest` files in a project, in the format the JetBrains HTTP Client and the VS Code
//! REST Client share, with a response beside each request. They live in the shared tree, so a team keeps its API calls with the code.
//!
//! ```text
//! @host = http://localhost:3000
//! ### Log in
//! POST {{host}}/login
//! Content-Type: application/json
//!
//! {"user": "ada"}
//! ```
//!
//! Variables come from `@name = value` lines in the file and from `http-client.env.json` (shared) and
//! `http-client.private.env.json` (kept on the device, for tokens) in the same folder, one section per environment.
//!
//! A request is sent by `curl`, which ships with Windows 10 and later, macOS and Linux, started with arguments and never through a
//! shell: only http and https, one of the usual methods, and a header that is a plain name and value. A request is sent only when a
//! person presses Send, and the address is shown before.

use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::Path,
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

use serde::Serialize;
use serde_json::Value;

use super::project_dir;
use crate::commands::config::validate_allowed_root;

const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const TIMEOUT_SECS: &str = "30";
const METHODS: &[&str] = &["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const SKIP: &[&str] = &["node_modules", ".git", "target", ".venv", "venv", "__pycache__", "Pods", ".gradle", "vendor", "dist", "build"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

/// The requests of a file and the variables it sets itself
pub fn parse(text: &str) -> (Vec<Request>, HashMap<String, String>) {
    let mut vars = HashMap::new();
    let mut requests = Vec::new();
    let mut name = String::new();
    let mut block: Vec<&str> = Vec::new();
    let flush = |name: &mut String, block: &mut Vec<&str>, requests: &mut Vec<Request>| {
        if let Some(r) = request_of(name, block) {
            requests.push(r);
        }
        name.clear();
        block.clear();
    };
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("###") {
            flush(&mut name, &mut block, &mut requests);
            name = rest.trim().to_string();
        } else if let Some(def) = line.strip_prefix('@').filter(|_| block.iter().all(|l| l.trim().is_empty())) {
            // `@host = value`, before a request's own lines
            if let Some((k, v)) = def.split_once('=') {
                vars.insert(k.trim().to_string(), v.trim().to_string());
            }
        } else {
            block.push(line);
        }
    }
    flush(&mut name, &mut block, &mut requests);
    (requests, vars)
}

fn request_of(name: &str, block: &[&str]) -> Option<Request> {
    let mut lines = block.iter().skip_while(|l| l.trim().is_empty() || is_comment(l));
    let first = lines.next()?.trim();
    let mut parts = first.split_whitespace();
    let (method, url) = match (parts.next()?, parts.next()) {
        (m, Some(u)) if METHODS.contains(&m.to_uppercase().as_str()) => (m.to_uppercase(), u.to_string()),
        // A bare address is a GET
        (u, None) if u.starts_with("http") || u.starts_with("{{") => ("GET".to_string(), u.to_string()),
        _ => return None,
    };
    let mut headers = Vec::new();
    let mut body: Vec<&str> = Vec::new();
    let mut in_body = false;
    for l in lines {
        if in_body {
            body.push(l);
        } else if l.trim().is_empty() {
            in_body = true;
        } else if is_comment(l) {
            continue;
        } else if let Some((k, v)) = l.split_once(':') {
            headers.push((k.trim().to_string(), v.trim().to_string()));
        }
    }
    let name = if name.is_empty() { format!("{method} {url}") } else { name.to_string() };
    Some(Request { name, method, url, headers, body: body.join("\n").trim().to_string() })
}

fn is_comment(l: &str) -> bool {
    let t = l.trim_start();
    t.starts_with('#') || t.starts_with("//")
}

/// Replaces `{{name}}` from the variables; a name that is not set is an error, so nothing goes out with a hole in it
pub fn fill(text: &str, vars: &HashMap<String, String>) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = text;
    while let Some(i) = rest.find("{{") {
        out.push_str(&rest[..i]);
        let after = &rest[i + 2..];
        let Some(j) = after.find("}}") else { return Err("A {{ has no closing }}.".to_string()) };
        let name = after[..j].trim();
        // Values may use other values (`{{host}}/v1`) once
        let value = vars.get(name).ok_or_else(|| format!("{{{{{name}}}}} is not set. Add `@{name} = ...` to the file, or choose an environment that has it."))?;
        out.push_str(&if value.contains("{{") { fill_once(value, vars)? } else { value.clone() });
        rest = &after[j + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

fn fill_once(text: &str, vars: &HashMap<String, String>) -> Result<String, String> {
    let flat: HashMap<String, String> = vars.iter().map(|(k, v)| (k.clone(), v.replace("{{", "").replace("}}", ""))).collect();
    fill(text, &flat)
}

/// The variables of one environment from the env files beside a request file (the private file wins)
pub fn env_vars(folder: &Path, env: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for file in ["http-client.env.json", "http-client.private.env.json"] {
        let Ok(text) = fs::read_to_string(folder.join(file)) else { continue };
        let Ok(Value::Object(all)) = serde_json::from_str::<Value>(&text) else { continue };
        if let Some(Value::Object(section)) = all.get(env) {
            for (k, v) in section {
                out.insert(k.clone(), v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string()));
            }
        }
    }
    out
}

/// Names of the environments the env files beside a request file define
pub fn env_names(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for file in ["http-client.env.json", "http-client.private.env.json"] {
        if let Some(Value::Object(all)) = fs::read_to_string(folder.join(file)).ok().and_then(|t| serde_json::from_str(&t).ok()) {
            names.extend(all.keys().filter(|k| !k.starts_with('$')).cloned());
        }
    }
    names.sort();
    names.dedup();
    names
}

fn token(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "!#$%&'*+-.^_`|~".contains(c))
}

/// The `curl` arguments for a request after its variables are filled: checked here, so nothing odd reaches the program
pub fn curl_args(r: &Request) -> Result<Vec<String>, String> {
    if !METHODS.contains(&r.method.as_str()) {
        return Err("That method is not one Nexsync sends.".to_string());
    }
    let lower = r.url.to_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) || r.url.chars().any(|c| c.is_control() || c == ' ') {
        return Err("The address must start with http:// or https:// and have no spaces.".to_string());
    }
    let mut args: Vec<String> = ["-sS", "-i", "--max-time", TIMEOUT_SECS, "--proto", "=http,https", "--max-filesize", "10485760", "-X", &r.method].iter().map(|s| s.to_string()).collect();
    if r.method == "HEAD" {
        // `-I` sends a HEAD; `-X HEAD` would wait for a body that never comes
        args.drain(args.len() - 2..);
        args.push("-I".to_string());
    }
    for (k, v) in &r.headers {
        if !token(k) || v.chars().any(|c| c == '\r' || c == '\n' || c == '\0') {
            return Err(format!("The header \"{k}\" is not a plain name and value."));
        }
        args.push("-H".to_string());
        args.push(format!("{k}: {v}"));
    }
    if !r.body.is_empty() {
        args.extend(["--data-binary".to_string(), "@-".to_string()]);
    }
    args.push("--".to_string());
    args.push(r.url.clone());
    Ok(args)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub ms: u64,
    pub truncated: bool,
}

type Read = (u16, Vec<(String, String)>, String, bool);

/// The status, headers and body in what `curl -i` printed (the last response, when a proxy or `100 Continue` put others before it)
pub fn read_response(raw: &[u8]) -> Option<Read> {
    let mut rest = raw;
    loop {
        let split = rest.windows(4).position(|w| w == b"\r\n\r\n")?;
        let head = String::from_utf8_lossy(&rest[..split]).into_owned();
        let after = &rest[split + 4..];
        let mut lines = head.lines();
        let status: u16 = lines.next()?.split_whitespace().nth(1)?.parse().ok()?;
        // A response that is only a status for the one that follows (100, 1xx, or a proxy's 200 Connection established)
        if (status < 200 || head.starts_with("HTTP/1.1 200 Connection established")) && after.starts_with(b"HTTP/") {
            rest = after;
            continue;
        }
        let headers = lines.filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))).collect();
        let truncated = after.len() > MAX_RESPONSE_BYTES;
        let body = String::from_utf8_lossy(&after[..after.len().min(MAX_RESPONSE_BYTES)]).into_owned();
        return Some((status, headers, body, truncated));
    }
}

fn send(r: &Request) -> Result<Response, String> {
    let args = curl_args(r)?;
    let started = Instant::now();
    let mut command = Command::new("curl");
    command.args(&args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|_| "curl was not found. It ships with Windows 10 and later, macOS and most Linux systems.".to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let body = r.body.clone();
        std::thread::spawn(move || {
            let _ = stdin.write_all(body.as_bytes());
        });
    }
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    let out = rx.recv_timeout(Duration::from_secs(40)).map_err(|_| "The request took too long.".to_string())?.map_err(|e| e.to_string())?;
    let ms = started.elapsed().as_millis() as u64;
    match read_response(&out.stdout) {
        Some((status, headers, body, truncated)) => Ok(Response { status, headers, body, ms, truncated }),
        None => {
            let why = String::from_utf8_lossy(&out.stderr);
            Err(why.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("There was no answer.").to_string())
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HttpFile {
    /// Inside the project
    pub path: String,
    pub requests: Vec<Request>,
    pub envs: Vec<String>,
}

fn walk(root: &Path, rel: &str, depth: usize, out: &mut Vec<HttpFile>) {
    let dir = if rel.is_empty() { root.to_path_buf() } else { root.join(rel) };
    let Ok(rd) = fs::read_dir(&dir) else { return };
    let mut entries: Vec<_> = rd.filter_map(Result::ok).collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let name = e.file_name().to_string_lossy().into_owned();
        let Ok(meta) = e.path().symlink_metadata() else { continue };
        let path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        if meta.is_dir() && depth < 4 && !SKIP.contains(&name.as_str()) && !name.starts_with('.') {
            walk(root, &path, depth + 1, out);
        } else if meta.is_file() && meta.len() <= MAX_FILE_BYTES && (name.ends_with(".http") || name.ends_with(".rest")) {
            let Ok(text) = fs::read_to_string(e.path()) else { continue };
            let (requests, _) = parse(&text);
            if !requests.is_empty() {
                out.push(HttpFile { path, requests, envs: env_names(&dir) });
            }
        }
        if out.len() >= 40 {
            return;
        }
    }
}

pub fn find(dir: &Path) -> Vec<HttpFile> {
    let mut out = Vec::new();
    walk(dir, "", 0, &mut out);
    out
}

#[tauri::command(async)]
pub fn project_http_files(app_handle: tauri::AppHandle, path: String, project: String) -> Result<Vec<HttpFile>, String> {
    validate_allowed_root(&app_handle, &path)?;
    Ok(find(&project_dir(&path, &project)?))
}

/// Sends request number `index` of a file, in an environment (empty for none), and returns the answer
#[tauri::command]
pub async fn project_http_send(app_handle: tauri::AppHandle, path: String, project: String, file: String, index: usize, env: String) -> Result<Response, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dir = project_dir(&path, &project)?;
    if file.split('/').any(|p| p == ".." || p.is_empty()) || !(file.ends_with(".http") || file.ends_with(".rest")) {
        return Err("That is not a request file.".to_string());
    }
    let target = dir.join(&file);
    let text = fs::read_to_string(&target).map_err(|_| "That file is gone.".to_string())?;
    let (requests, mut vars) = parse(&text);
    let request = requests.get(index).ok_or("That request is no longer in the file.")?.clone();
    if !env.is_empty() {
        vars.extend(env_vars(target.parent().unwrap_or(&dir), &env));
    }
    let filled = Request {
        url: fill(&request.url, &vars)?,
        headers: request.headers.iter().map(|(k, v)| Ok((k.clone(), fill(v, &vars)?))).collect::<Result<_, String>>()?,
        body: fill(&request.body, &vars)?,
        ..request
    };
    tokio::task::spawn_blocking(move || send(&filled)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = "@host = http://localhost:3000\n@token=abc\n\n### Log in\n# a comment\nPOST {{host}}/login\nContent-Type: application/json\nAuthorization: Bearer {{token}}\n\n{\"user\": \"ada\"}\n\n###\nGET {{host}}/me\n\n### Health\nhttp://localhost:3000/health\n\n### Not a request\nthis is text\n";

    #[test]
    fn requests_are_read_the_way_both_editors_write_them() {
        let (r, vars) = parse(FILE);
        assert_eq!(vars["host"], "http://localhost:3000");
        assert_eq!(r.iter().map(|x| (x.name.as_str(), x.method.as_str())).collect::<Vec<_>>(), [("Log in", "POST"), ("GET {{host}}/me", "GET"), ("Health", "GET")]);
        assert_eq!(r[0].headers, [("Content-Type".to_string(), "application/json".to_string()), ("Authorization".to_string(), "Bearer {{token}}".to_string())]);
        assert_eq!(r[0].body, "{\"user\": \"ada\"}");
    }

    #[test]
    fn variables_are_filled_and_a_missing_one_stops_the_request() {
        let (r, vars) = parse(FILE);
        assert_eq!(fill(&r[0].url, &vars).unwrap(), "http://localhost:3000/login");
        assert_eq!(fill(&r[0].headers[1].1, &vars).unwrap(), "Bearer abc");
        assert!(fill("{{missing}}/x", &vars).unwrap_err().contains("missing"));
        assert!(fill("{{open", &vars).is_err());
    }

    #[test]
    fn environments_come_from_the_env_files_and_the_private_one_wins() {
        let d = std::env::temp_dir().join(format!("nexsync-http-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("http-client.env.json"), r#"{"dev":{"host":"http://localhost:1","token":"shared"},"prod":{"host":"https://x"}}"#).unwrap();
        fs::write(d.join("http-client.private.env.json"), r#"{"dev":{"token":"secret"}}"#).unwrap();
        assert_eq!(env_names(&d), ["dev", "prod"]);
        let v = env_vars(&d, "dev");
        assert_eq!((v["host"].as_str(), v["token"].as_str()), ("http://localhost:1", "secret"));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn nothing_but_a_plain_http_request_becomes_arguments() {
        let ok = Request { name: "x".into(), method: "POST".into(), url: "https://example.com/a?b=1".into(), headers: vec![("X-A".into(), "b".into())], body: "{}".into() };
        let args = curl_args(&ok).unwrap();
        assert!(args.windows(2).any(|w| w == ["-H", "X-A: b"]) && args.contains(&"--data-binary".to_string()) && args.ends_with(&["--".to_string(), "https://example.com/a?b=1".to_string()]));
        let bad = |f: &dyn Fn(&mut Request)| {
            let mut r = ok.clone();
            f(&mut r);
            curl_args(&r).is_err()
        };
        assert!(bad(&|r| r.url = "file:///etc/passwd".into()));
        assert!(bad(&|r| r.url = "http://a b".into()));
        assert!(bad(&|r| r.url = "ftp://x".into()));
        assert!(bad(&|r| r.method = "TRACE".into()));
        assert!(bad(&|r| r.headers = vec![("X\r\nHost".into(), "y".into())]));
        assert!(bad(&|r| r.headers = vec![("@file".into(), "y".into())]));
        assert!(bad(&|r| r.headers = vec![("X".into(), "a\nb".into())]));
        let mut head = ok.clone();
        head.method = "HEAD".into();
        assert!(curl_args(&head).unwrap().contains(&"-I".to_string()));
    }

    #[test]
    fn a_request_reaches_a_local_server_with_its_body_and_the_answer_comes_back() {
        use std::io::{Read, Write};
        if Command::new("curl").arg("--version").output().is_err() {
            return;
        }
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let mut got = Vec::new();
            // The request is read until its body has arrived
            while !String::from_utf8_lossy(&got).contains("{\"a\":1}") {
                let n = s.read(&mut buf).unwrap();
                if n == 0 {
                    break;
                }
                got.extend_from_slice(&buf[..n]);
            }
            s.write_all(b"HTTP/1.1 201 Created\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").unwrap();
            String::from_utf8_lossy(&got).into_owned()
        });
        let r = Request { name: "x".into(), method: "POST".into(), url: format!("http://127.0.0.1:{port}/things"), headers: vec![("X-Test".into(), "yes".into())], body: "{\"a\":1}".into() };
        let answer = send(&r).unwrap();
        assert_eq!((answer.status, answer.body.as_str()), (201, "ok"));
        let seen = server.join().unwrap();
        assert!(seen.starts_with("POST /things") && seen.to_lowercase().contains("x-test: yes"));
    }

    #[test]
    fn a_response_is_read_past_a_100_continue_and_cut_at_the_limit() {
        let raw = b"HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 201 Created\r\nContent-Type: text/plain\r\nX-A: b\r\n\r\nhello";
        let (status, headers, body, cut) = read_response(raw).unwrap();
        assert_eq!((status, body.as_str(), cut), (201, "hello", false));
        assert_eq!(headers[1], ("X-A".to_string(), "b".to_string()));
        assert!(read_response(b"not http").is_none());
        let big = [b"HTTP/1.1 200 OK\r\n\r\n".to_vec(), vec![b'x'; MAX_RESPONSE_BYTES + 5]].concat();
        let (_, _, body, cut) = read_response(&big).unwrap();
        assert!(cut && body.len() == MAX_RESPONSE_BYTES);
    }
}
