//! Containers (Phase 20, step 8): whether Docker is installed and running, what a project's Compose file runs and how each service
//! is doing, the Dockerfiles it has, and what its `.devcontainer` says.
//!
//! Only fixed `docker` commands with fixed arguments are started (`version`, `compose config --services`, `compose ps`), in the
//! project's folder; none of them starts a container or runs the project's code. Starting, stopping and following logs are tasks
//! like any other, so they ask for the same approval. Nexsync does not install or bundle Docker, and a Dev Container is only read,
//! never opened: the editor does not run inside a container.

use std::{fs, path::Path};

use serde::Serialize;
use serde_json::Value;

use super::{audit::run_fixed, project_dir};
use crate::commands::config::validate_allowed_root;

const COMPOSE_FILES: &[&str] = &["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"];
const SKIP: &[&str] = &["node_modules", ".git", "target", ".venv", "venv", "vendor", "dist", "build"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub name: String,
    /// `running`, `exited`, `created`, `paused`, `restarting`, `dead`, or `none` when there is no container yet
    pub state: String,
    /// What Docker said about it: "Up 3 minutes (healthy)"
    pub status: String,
    /// Host ports the service publishes
    pub ports: Vec<u16>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DevContainer {
    pub name: String,
    pub image: String,
    pub dockerfile: String,
    pub compose_file: String,
    pub forward_ports: Vec<u16>,
    pub post_create: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Docker {
    /// `missing` (not installed), `stopped` (installed, the engine is not answering) or `running`
    pub state: &'static str,
    pub version: String,
    pub note: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Containers {
    pub docker: Docker,
    pub compose_file: Option<String>,
    pub services: Vec<Service>,
    pub dockerfiles: Vec<String>,
    pub devcontainer: Option<DevContainer>,
}

/// JSON with comments and trailing commas, which is what `devcontainer.json` is allowed to be
pub fn strip_jsonc(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let (mut i, mut in_str) = (0, false);
    while i < chars.len() {
        let c = chars[i];
        if in_str {
            out.push(c);
            if c == '\\' && i + 1 < chars.len() {
                out.push(chars[i + 1]);
                i += 1;
            } else if c == '"' {
                in_str = false;
            }
        } else if c == '"' {
            in_str = true;
            out.push(c);
        } else if c == '/' && chars.get(i + 1) == Some(&'/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        } else if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
            continue;
        } else {
            out.push(c);
        }
        i += 1;
    }
    // A comma before a closing bracket
    let mut clean = String::with_capacity(out.len());
    let bytes: Vec<char> = out.chars().collect();
    let mut in_str = false;
    for (i, &c) in bytes.iter().enumerate() {
        if in_str {
            clean.push(c);
            if c == '"' && bytes[i.saturating_sub(1)] != '\\' {
                in_str = false;
            }
            continue;
        }
        if c == '"' {
            in_str = true;
        }
        if c == ',' && bytes[i + 1..].iter().find(|x| !x.is_whitespace()).is_some_and(|x| matches!(x, '}' | ']')) {
            continue;
        }
        clean.push(c);
    }
    clean
}

fn string_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "),
        Value::Object(o) => o.values().filter_map(Value::as_str).collect::<Vec<_>>().join(" && "),
        _ => String::new(),
    }
}

/// What a `devcontainer.json` says that Nexsync shows: where it runs from, and the ports and command it names
pub fn parse_devcontainer(text: &str) -> Option<DevContainer> {
    let v: Value = serde_json::from_str(&strip_jsonc(text)).ok()?;
    let o = v.as_object()?;
    let get = |k: &str| o.get(k).map(string_of).unwrap_or_default();
    let ports = o.get("forwardPorts").and_then(Value::as_array).map(|a| a.iter().filter_map(|p| p.as_u64().and_then(|n| u16::try_from(n).ok()).or_else(|| p.as_str().and_then(|s| s.rsplit(':').next()).and_then(|s| s.parse().ok()))).collect()).unwrap_or_default();
    Some(DevContainer {
        name: get("name"),
        image: get("image"),
        dockerfile: o.get("build").and_then(|b| b.get("dockerfile")).map(string_of).unwrap_or_default(),
        compose_file: get("dockerComposeFile"),
        forward_ports: ports,
        post_create: get("postCreateCommand"),
    })
}

/// Host ports a Dockerfile's `EXPOSE` lines name (`EXPOSE 3000 8080/tcp`)
pub fn expose_ports(text: &str) -> Vec<u16> {
    let mut out: Vec<u16> = Vec::new();
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("EXPOSE ") {
            for p in rest.split_whitespace() {
                if let Ok(n) = p.split('/').next().unwrap_or("").parse::<u16>() {
                    if !out.contains(&n) {
                        out.push(n);
                    }
                }
            }
        }
    }
    out
}

fn service_of(v: &Value) -> Option<Service> {
    let name = v.get("Service").or_else(|| v.get("Name")).and_then(Value::as_str)?.to_string();
    let ports = v
        .get("Publishers")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|p| p.get("PublishedPort").and_then(Value::as_u64)).filter(|p| *p > 0).filter_map(|p| u16::try_from(p).ok()).collect::<Vec<u16>>())
        .map(|mut p| {
            p.sort_unstable();
            p.dedup();
            p
        })
        .unwrap_or_default();
    Some(Service { name, state: v.get("State").and_then(Value::as_str).unwrap_or("none").to_lowercase(), status: v.get("Status").and_then(Value::as_str).unwrap_or("").to_string(), ports })
}

/// `docker compose ps --format json`: one object per line in recent versions, one array in others
pub fn parse_ps(text: &str) -> Vec<Service> {
    let t = text.trim();
    if t.starts_with('[') {
        return serde_json::from_str::<Vec<Value>>(t).map(|a| a.iter().filter_map(service_of).collect()).unwrap_or_default();
    }
    t.lines().filter_map(|l| serde_json::from_str::<Value>(l.trim()).ok()).filter_map(|v| service_of(&v)).collect()
}

/// The services the Compose file declares, joined with what is running: a service with no container shows as `none`
pub fn join_services(declared: &[String], running: Vec<Service>) -> Vec<Service> {
    let mut out: Vec<Service> = declared.iter().map(|n| running.iter().find(|s| &s.name == n).cloned().unwrap_or(Service { name: n.clone(), state: "none".into(), status: String::new(), ports: Vec::new() })).collect();
    for s in running {
        if !out.iter().any(|o| o.name == s.name) {
            out.push(s);
        }
    }
    out
}

fn dockerfiles(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut look = |rel: &str| {
        let Ok(rd) = fs::read_dir(if rel.is_empty() { dir.to_path_buf() } else { dir.join(rel) }) else { return };
        for e in rd.filter_map(Result::ok) {
            let name = e.file_name().to_string_lossy().into_owned();
            if e.path().is_file() && (name == "Dockerfile" || name.starts_with("Dockerfile.") || name.ends_with(".Dockerfile") || name.ends_with(".dockerfile")) {
                out.push(if rel.is_empty() { name } else { format!("{rel}/{name}") });
            }
        }
    };
    look("");
    if let Ok(rd) = fs::read_dir(dir) {
        let mut subs: Vec<String> = rd.filter_map(Result::ok).filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| !n.starts_with('.') && !SKIP.contains(&n.as_str())).collect();
        subs.sort();
        for s in subs.into_iter().take(30) {
            look(&s);
        }
    }
    out.truncate(20);
    out
}

fn devcontainer(dir: &Path) -> Option<DevContainer> {
    [".devcontainer/devcontainer.json", ".devcontainer.json"].iter().find_map(|f| {
        let p = dir.join(f);
        (p.metadata().ok()?.len() < 256 * 1024).then(|| fs::read_to_string(p).ok().and_then(|t| parse_devcontainer(&t))).flatten()
    })
}

/// What Docker, the Compose file and the folder say about the project
pub fn look(dir: &Path) -> Containers {
    let compose_file = COMPOSE_FILES.iter().find(|f| dir.join(f).is_file()).map(|f| f.to_string());
    let docker = match run_fixed(dir, "docker", &["version", "--format", "{{.Server.Version}}"]) {
        Ok(v) => Docker { state: "running", version: v.trim().to_string(), note: String::new() },
        Err(e) if e.contains("not recognized") || e.contains("not found") || e.contains("did not start") || e.contains("No such file") => Docker { state: "missing", version: String::new(), note: "Docker is not installed, or not on this app's PATH.".to_string() },
        Err(e) => Docker { state: "stopped", version: String::new(), note: e },
    };
    let mut services = Vec::new();
    if compose_file.is_some() && docker.state == "running" {
        let declared: Vec<String> = run_fixed(dir, "docker", &["compose", "config", "--services"]).map(|t| t.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()).unwrap_or_default();
        let running = run_fixed(dir, "docker", &["compose", "ps", "--all", "--format", "json"]).map(|t| parse_ps(&t)).unwrap_or_default();
        services = join_services(&declared, running);
    }
    Containers { docker, compose_file, services, dockerfiles: dockerfiles(dir), devcontainer: devcontainer(dir) }
}

/// Docker's state and a project's containers, asked when the page opens
#[tauri::command]
pub async fn project_containers(app_handle: tauri::AppHandle, path: String, project: String) -> Result<Containers, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dir = project_dir(&path, &project)?;
    tokio::task::spawn_blocking(move || look(&dir)).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_devcontainer_file_with_comments_and_trailing_commas_is_read() {
        let text = "{\n  // the image\n  \"name\": \"web // dev\", /* note */\n  \"image\": \"mcr.microsoft.com/devcontainers/node:20\",\n  \"forwardPorts\": [3000, \"db:5432\",],\n  \"postCreateCommand\": \"npm ci\",\n  \"build\": {\"dockerfile\": \"Dockerfile\",},\n}";
        let d = parse_devcontainer(text).unwrap();
        assert_eq!((d.name.as_str(), d.image.as_str(), d.post_create.as_str(), d.dockerfile.as_str()), ("web // dev", "mcr.microsoft.com/devcontainers/node:20", "npm ci", "Dockerfile"));
        assert_eq!(d.forward_ports, [3000, 5432]);
        assert!(parse_devcontainer("not json").is_none());
    }

    #[test]
    fn compose_status_is_read_from_lines_or_an_array_and_joined_with_the_declared_services() {
        let lines = "{\"Service\":\"web\",\"State\":\"running\",\"Status\":\"Up 2 minutes\",\"Publishers\":[{\"PublishedPort\":8080,\"TargetPort\":80},{\"PublishedPort\":8080,\"TargetPort\":80},{\"PublishedPort\":0}]}\n{\"Service\":\"db\",\"State\":\"Exited\",\"Status\":\"Exited (1)\"}";
        let ps = parse_ps(lines);
        assert_eq!((ps.len(), ps[0].ports.clone(), ps[1].state.as_str()), (2, vec![8080], "exited"));
        assert_eq!(parse_ps("[{\"Service\":\"web\",\"State\":\"running\"}]").len(), 1);
        let joined = join_services(&["web".into(), "cache".into(), "db".into()], ps);
        assert_eq!(joined.iter().map(|s| (s.name.as_str(), s.state.as_str())).collect::<Vec<_>>(), [("web", "running"), ("cache", "none"), ("db", "exited")]);
        assert!(parse_ps("").is_empty());
    }

    #[test]
    fn a_dockerfile_gives_a_build_and_a_run_that_publishes_what_it_exposes_and_compose_gives_logs() {
        let base = std::env::temp_dir().join(format!("nexsync-docker-{}", uuid::Uuid::new_v4()));
        let app = base.join("My App");
        fs::create_dir_all(&app).unwrap();
        fs::write(app.join("Dockerfile"), "FROM node
EXPOSE 3000
").unwrap();
        let tasks = super::super::detect(&app).tasks;
        let build = tasks.iter().find(|t| t.id == "build").unwrap();
        let run = tasks.iter().find(|t| t.id == "run").unwrap();
        assert_eq!(build.command, "docker build -t my-app .");
        assert_eq!((run.command.as_str(), run.ports.clone(), run.watch), ("docker run --rm -p 3000:3000 my-app", vec![3000], true));
        let both = base.join("stack");
        fs::create_dir_all(&both).unwrap();
        fs::write(both.join("compose.yaml"), "services: {}").unwrap();
        let tasks = super::super::detect(&both).tasks;
        assert!(tasks.iter().any(|t| t.id == "logs" && t.watch) && tasks.iter().any(|t| t.id == "ps"));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn exposed_ports_are_found() {
        assert_eq!(expose_ports("FROM node\nEXPOSE 3000 8080/tcp\n  EXPOSE 3000\nRUN x"), [3000, 8080]);
    }

    #[test]
    fn dockerfiles_are_found_at_the_top_and_one_folder_down() {
        let d = std::env::temp_dir().join(format!("nexsync-docker-{}", uuid::Uuid::new_v4()));
        for f in ["Dockerfile", "api/Dockerfile.prod", "web/web.Dockerfile", "node_modules/x/Dockerfile", "deep/a/Dockerfile", "README.md"] {
            let p = d.join(f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, "FROM scratch").unwrap();
        }
        assert_eq!(dockerfiles(&d), ["Dockerfile", "api/Dockerfile.prod", "web/web.Dockerfile"]);
        let _ = fs::remove_dir_all(&d);
    }
}
