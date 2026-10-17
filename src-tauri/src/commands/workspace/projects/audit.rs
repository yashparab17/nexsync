//! Dependency health (Phase 20, ideas): known-vulnerable and out-of-date packages of a project, from the audit commands the
//! ecosystems ship (`npm audit`, `pnpm audit`, `cargo audit`, `pip-audit`) and `npm outdated`.
//!
//! Only fixed commands with fixed arguments are started, in the project's folder, and none of them runs the project's code. They
//! do contact the package registry, so this runs when a person asks, never by itself. A tool that is not installed is reported
//! as such with how to get it, and nothing is installed for the person.

use std::{
    path::Path,
    process::{Command, Stdio},
    sync::mpsc,
    time::Duration,
};

use serde::Serialize;
use serde_json::Value;

use super::{package_manager, project_dir};
use crate::commands::config::validate_allowed_root;

const TIMEOUT: Duration = Duration::from_secs(120);
const MAX_ROWS: usize = 200;

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub package: String,
    pub version: String,
    /// `critical`, `high`, `moderate`, `low` or `unknown`
    pub severity: String,
    pub id: String,
    pub title: String,
    /// The version or command that fixes it, when one is known
    pub fix: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Outdated {
    pub package: String,
    pub current: String,
    pub latest: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Audit {
    pub ecosystem: &'static str,
    pub findings: Vec<Finding>,
    pub outdated: Vec<Outdated>,
    /// Why part of it could not be done: a tool that is missing, a registry that did not answer
    pub notes: Vec<String>,
}

const ORDER: &[&str] = &["critical", "high", "moderate", "low", "unknown"];

fn rank(severity: &str) -> usize {
    ORDER.iter().position(|s| *s == severity).unwrap_or(ORDER.len())
}

fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

fn severity(s: &str) -> String {
    let s = s.to_lowercase();
    if ORDER.contains(&s.as_str()) { s } else { "unknown".to_string() }
}

/// `npm audit --json` (and pnpm's, which has the same shape): one entry per vulnerable package
pub fn parse_npm_audit(json: &str) -> Option<Vec<Finding>> {
    let v: Value = serde_json::from_str(json).ok()?;
    let map = v.get("vulnerabilities")?.as_object()?;
    let mut out: Vec<Finding> = map
        .iter()
        .map(|(name, e)| {
            // `via` holds advisories (objects) and the names of packages that bring one in (strings)
            let via = e.get("via").and_then(Value::as_array).cloned().unwrap_or_default();
            let advisory = via.iter().find(|x| x.is_object());
            let title = advisory.map(|a| text(a, "title")).filter(|t| !t.is_empty()).unwrap_or_else(|| format!("through {}", via.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")));
            let id = advisory.map(|a| text(a, "url")).unwrap_or_default();
            let fix = match e.get("fixAvailable") {
                Some(Value::Object(f)) => format!("{} {}", f.get("name").and_then(Value::as_str).unwrap_or(name), f.get("version").and_then(Value::as_str).unwrap_or("")).trim().to_string(),
                Some(Value::Bool(true)) => "npm audit fix".to_string(),
                _ => String::new(),
            };
            Finding { package: name.clone(), version: text(e, "range"), severity: severity(&text(e, "severity")), id, title, fix }
        })
        .collect();
    out.sort_by(|a, b| rank(&a.severity).cmp(&rank(&b.severity)).then(a.package.cmp(&b.package)));
    Some(out)
}

/// `npm outdated --json`: `{ name: { current, wanted, latest } }`; a package that is not installed has no `current`
pub fn parse_npm_outdated(json: &str) -> Option<Vec<Outdated>> {
    let v: Value = serde_json::from_str(json).ok()?;
    let mut out: Vec<Outdated> = v.as_object()?.iter().filter(|(_, e)| e.get("current").is_some()).map(|(n, e)| Outdated { package: n.clone(), current: text(e, "current"), latest: text(e, "latest") }).filter(|o| o.current != o.latest).collect();
    out.sort_by(|a, b| a.package.cmp(&b.package));
    Some(out)
}

/// `cargo audit --json`
pub fn parse_cargo_audit(json: &str) -> Option<Vec<Finding>> {
    let v: Value = serde_json::from_str(json).ok()?;
    let list = v.pointer("/vulnerabilities/list")?.as_array()?;
    Some(
        list.iter()
            .map(|e| {
                let patched = e.pointer("/versions/patched").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" or ")).unwrap_or_default();
                Finding {
                    package: e.pointer("/package/name").and_then(Value::as_str).unwrap_or("").to_string(),
                    version: e.pointer("/package/version").and_then(Value::as_str).unwrap_or("").to_string(),
                    // The advisory database rates few of them; the CVSS score is not read, so they are listed as unrated
                    severity: "unknown".to_string(),
                    id: e.pointer("/advisory/id").and_then(Value::as_str).unwrap_or("").to_string(),
                    title: e.pointer("/advisory/title").and_then(Value::as_str).unwrap_or("").to_string(),
                    fix: patched,
                }
            })
            .collect(),
    )
}

/// `pip-audit -f json`: `{ dependencies: [...] }`, or a bare list in older versions
pub fn parse_pip_audit(json: &str) -> Option<Vec<Finding>> {
    let v: Value = serde_json::from_str(json).ok()?;
    let deps = v.get("dependencies").and_then(Value::as_array).or_else(|| v.as_array())?;
    let mut out = Vec::new();
    for d in deps {
        for vuln in d.get("vulns").and_then(Value::as_array).into_iter().flatten() {
            let fix = vuln.get("fix_versions").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" or ")).unwrap_or_default();
            out.push(Finding { package: text(d, "name"), version: text(d, "version"), severity: "unknown".to_string(), id: text(vuln, "id"), title: text(vuln, "description").chars().take(160).collect(), fix });
        }
    }
    Some(out)
}

#[cfg(windows)]
fn start(program: &str, args: &[&str]) -> Command {
    use std::os::windows::process::CommandExt;
    // Programs such as npm are .cmd files, which only the command interpreter finds
    let mut c = Command::new("cmd");
    c.arg("/C").arg(program).args(args);
    c.creation_flags(0x0800_0000);
    c
}

#[cfg(not(windows))]
fn start(program: &str, args: &[&str]) -> Command {
    let mut c = Command::new(program);
    c.args(args);
    c
}

/// What a fixed command printed (its output when it printed any, whatever it exited with: audits exit 1 when they find something),
/// or the reason it printed nothing
pub(crate) fn run_fixed(dir: &Path, program: &str, args: &[&str]) -> Result<String, String> {
    let mut c = start(program, args);
    c.current_dir(dir).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(c.output());
    });
    let out = rx.recv_timeout(TIMEOUT).map_err(|_| format!("{program} took too long."))?.map_err(|e| format!("{program} did not start: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if stdout.trim().is_empty() {
        let err = String::from_utf8_lossy(&out.stderr);
        let first = err.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("it printed nothing");
        return Err(format!("{program} {}: {first}", args.first().unwrap_or(&"")));
    }
    Ok(stdout)
}

fn capped<T>(mut v: Vec<T>) -> Vec<T> {
    v.truncate(MAX_ROWS);
    v
}

/// The audits that apply to the folder, one per ecosystem it has a lock file for
pub fn audit(dir: &Path) -> Vec<Audit> {
    let mut out = Vec::new();
    let has = |f: &str| dir.join(f).exists();
    if has("package.json") {
        let mut a = Audit { ecosystem: "npm", ..Default::default() };
        match (package_manager(dir), has("package-lock.json") || has("pnpm-lock.yaml")) {
            (pm @ ("npm" | "pnpm"), true) => {
                match run_fixed(dir, pm, &["audit", "--json"]).and_then(|t| parse_npm_audit(&t).ok_or_else(|| format!("{pm} audit gave an answer that is not understood."))) {
                    Ok(f) => a.findings = capped(f),
                    Err(e) => a.notes.push(e),
                }
                let outdated = if pm == "pnpm" { run_fixed(dir, pm, &["outdated", "--format", "json"]) } else { run_fixed(dir, pm, &["outdated", "--json"]) };
                // `outdated` prints nothing when everything is current, which is not an error
                if let Ok(t) = outdated {
                    a.outdated = capped(parse_npm_outdated(&t).unwrap_or_default());
                }
            }
            (pm, _) if pm != "npm" && pm != "pnpm" => a.notes.push(format!("Audits with {pm} are not read yet; npm and pnpm are.")),
            _ => a.notes.push("There is no lock file, so there is nothing to audit. Install the dependencies first.".to_string()),
        }
        out.push(a);
    }
    if has("Cargo.lock") {
        let mut a = Audit { ecosystem: "cargo", ..Default::default() };
        match run_fixed(dir, "cargo", &["audit", "--json"]) {
            Ok(t) => match parse_cargo_audit(&t) {
                Some(f) => a.findings = capped(f),
                None => a.notes.push("cargo audit gave an answer that is not understood.".to_string()),
            },
            Err(e) if e.contains("no such command") || e.contains("not found") => a.notes.push("cargo-audit is not installed. Install it with: cargo install cargo-audit".to_string()),
            Err(e) => a.notes.push(e),
        }
        out.push(a);
    }
    if has("requirements.txt") || has("pyproject.toml") {
        let mut a = Audit { ecosystem: "python", ..Default::default() };
        let args: &[&str] = if has("requirements.txt") { &["-f", "json", "-r", "requirements.txt"] } else { &["-f", "json"] };
        match run_fixed(dir, "pip-audit", args) {
            Ok(t) => match parse_pip_audit(&t) {
                Some(f) => a.findings = capped(f),
                None => a.notes.push("pip-audit gave an answer that is not understood.".to_string()),
            },
            Err(e) if e.contains("not recognized") || e.contains("not found") || e.contains("did not start") => a.notes.push("pip-audit is not installed. Install it with: pip install pip-audit".to_string()),
            Err(e) => a.notes.push(e),
        }
        out.push(a);
    }
    out
}

/// Looks for known-vulnerable and out-of-date packages of a project; contacts the package registries, so only on request
#[tauri::command]
pub async fn project_audit(app_handle: tauri::AppHandle, path: String, project: String) -> Result<Vec<Audit>, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dir = project_dir(&path, &project)?;
    tokio::task::spawn_blocking(move || audit(&dir)).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn npm_audit_lists_the_worst_first_with_the_advisory_and_the_fix() {
        let json = r#"{"vulnerabilities":{
            "lodash":{"name":"lodash","severity":"high","range":"<4.17.21","via":[{"source":1,"title":"Prototype Pollution","url":"https://github.com/advisories/GHSA-x"}],"fixAvailable":true},
            "express":{"name":"express","severity":"critical","range":"<4.0.0","via":["qs"],"fixAvailable":{"name":"express","version":"4.19.2"}},
            "odd":{"name":"odd","severity":"strange","range":"*","via":[],"fixAvailable":false}}}"#;
        let f = parse_npm_audit(json).unwrap();
        assert_eq!(f.iter().map(|x| (x.package.as_str(), x.severity.as_str())).collect::<Vec<_>>(), [("express", "critical"), ("lodash", "high"), ("odd", "unknown")]);
        assert_eq!((f[0].title.as_str(), f[0].fix.as_str()), ("through qs", "express 4.19.2"));
        assert_eq!((f[1].title.as_str(), f[1].fix.as_str()), ("Prototype Pollution", "npm audit fix"));
        assert!(parse_npm_audit("not json").is_none() && parse_npm_audit("{}").is_none());
    }

    #[test]
    fn outdated_leaves_out_what_is_not_installed_or_already_current() {
        let json = r#"{"react":{"current":"18.2.0","wanted":"18.3.1","latest":"19.0.0"},"missing":{"wanted":"1.0.0","latest":"1.0.0"},"same":{"current":"1.0.0","latest":"1.0.0"}}"#;
        assert_eq!(parse_npm_outdated(json).unwrap(), [Outdated { package: "react".into(), current: "18.2.0".into(), latest: "19.0.0".into() }]);
    }

    #[test]
    fn cargo_and_pip_audits_are_read() {
        let cargo = r#"{"vulnerabilities":{"found":true,"list":[{"advisory":{"id":"RUSTSEC-2024-0001","title":"Bad thing"},"package":{"name":"foo","version":"0.1.0"},"versions":{"patched":[">=0.2.0"]}}]}}"#;
        let f = parse_cargo_audit(cargo).unwrap();
        assert_eq!((f[0].package.as_str(), f[0].id.as_str(), f[0].fix.as_str()), ("foo", "RUSTSEC-2024-0001", ">=0.2.0"));
        let pip = r#"{"dependencies":[{"name":"django","version":"3.0","vulns":[{"id":"PYSEC-1","fix_versions":["3.2.1","4.0"],"description":"x"}]},{"name":"ok","version":"1","vulns":[]}]}"#;
        let f = parse_pip_audit(pip).unwrap();
        assert_eq!((f.len(), f[0].fix.as_str()), (1, "3.2.1 or 4.0"));
        assert_eq!(parse_pip_audit(r#"[{"name":"a","version":"1","vulns":[{"id":"X"}]}]"#).unwrap().len(), 1);
    }
}
