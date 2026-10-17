//! The Doctor (Phase 20, step 2): is each program a project needs on this device, and is its version one the project accepts.
//!
//! Only programs on a fixed list are ever started, each with a fixed argument that prints a version. A tool named in a
//! recipe that is not on the list is reported as unknown and not run, so a recipe cannot make the Doctor run anything.
//! Nexsync never installs a program; the answer carries the command or page that does.

use std::{
    process::{Command, Stdio},
    sync::mpsc,
    time::Duration,
};

use serde::Serialize;

use super::projects::ToolReq;
use crate::commands::config::validate_allowed_root;

const ASK_TIMEOUT: Duration = Duration::from_secs(6);

/// A program the Doctor knows: what to start, with what, and where to get it
struct Known {
    name: &'static str,
    /// Programs to try in order (`python`, then `python3`) and the argument that prints a version
    programs: &'static [&'static str],
    arg: &'static str,
    /// The page that explains how to install it
    url: &'static str,
}

const KNOWN: &[Known] = &[
    Known { name: "node", programs: &["node"], arg: "--version", url: "https://nodejs.org/en/download" },
    Known { name: "npm", programs: &["npm"], arg: "--version", url: "https://nodejs.org/en/download" },
    Known { name: "pnpm", programs: &["pnpm"], arg: "--version", url: "https://pnpm.io/installation" },
    Known { name: "yarn", programs: &["yarn"], arg: "--version", url: "https://yarnpkg.com/getting-started/install" },
    Known { name: "bun", programs: &["bun"], arg: "--version", url: "https://bun.sh/docs/installation" },
    Known { name: "python", programs: &["python", "python3", "py"], arg: "--version", url: "https://www.python.org/downloads/" },
    Known { name: "uv", programs: &["uv"], arg: "--version", url: "https://docs.astral.sh/uv/getting-started/installation/" },
    Known { name: "poetry", programs: &["poetry"], arg: "--version", url: "https://python-poetry.org/docs/#installation" },
    Known { name: "cargo", programs: &["cargo"], arg: "--version", url: "https://rustup.rs" },
    Known { name: "rustc", programs: &["rustc"], arg: "--version", url: "https://rustup.rs" },
    Known { name: "go", programs: &["go"], arg: "version", url: "https://go.dev/dl/" },
    Known { name: "java", programs: &["java"], arg: "-version", url: "https://adoptium.net/" },
    Known { name: "mvn", programs: &["mvn"], arg: "--version", url: "https://maven.apache.org/install.html" },
    Known { name: "gradle", programs: &["gradle"], arg: "--version", url: "https://gradle.org/install/" },
    Known { name: "dotnet", programs: &["dotnet"], arg: "--version", url: "https://dotnet.microsoft.com/download" },
    Known { name: "php", programs: &["php"], arg: "--version", url: "https://www.php.net/downloads" },
    Known { name: "composer", programs: &["composer"], arg: "--version", url: "https://getcomposer.org/download/" },
    Known { name: "ruby", programs: &["ruby"], arg: "--version", url: "https://www.ruby-lang.org/en/downloads/" },
    Known { name: "bundler", programs: &["bundle"], arg: "--version", url: "https://bundler.io" },
    Known { name: "elixir", programs: &["elixir"], arg: "--version", url: "https://elixir-lang.org/install.html" },
    Known { name: "swift", programs: &["swift"], arg: "--version", url: "https://www.swift.org/install/" },
    Known { name: "flutter", programs: &["flutter"], arg: "--version", url: "https://docs.flutter.dev/get-started/install" },
    Known { name: "cmake", programs: &["cmake"], arg: "--version", url: "https://cmake.org/download/" },
    Known { name: "just", programs: &["just"], arg: "--version", url: "https://just.systems/man/en/packages.html" },
    Known { name: "task", programs: &["task"], arg: "--version", url: "https://taskfile.dev/installation/" },
    Known { name: "make", programs: &["make"], arg: "--version", url: "https://www.gnu.org/software/make/" },
    Known { name: "docker", programs: &["docker"], arg: "--version", url: "https://docs.docker.com/get-docker/" },
    Known { name: "terraform", programs: &["terraform"], arg: "--version", url: "https://developer.hashicorp.com/terraform/install" },
    Known { name: "git", programs: &["git"], arg: "--version", url: "https://git-scm.com/downloads" },
];

/// Programs that keep several versions of a language side by side; shown so a wrong version has an easy fix
const MANAGERS: &[(&str, &str)] = &[("fnm", "--version"), ("volta", "--version"), ("nvm", "--version"), ("rustup", "--version"), ("pyenv", "--version"), ("asdf", "--version"), ("mise", "--version")];

/// Asks inside a WSL distribution: its login shell finds the programs its own PATH holds
fn start_in(distro: &str, program: &str, arg: &str) -> Command {
    let mut c = Command::new("wsl.exe");
    c.args(["-d", distro, "--", "sh", "-lc", &format!("{program} {arg}")]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}

#[cfg(windows)]
fn start(program: &str, arg: &str) -> Command {
    use std::os::windows::process::CommandExt;
    // Programs such as npm are .cmd files, which only the command interpreter finds
    let mut c = Command::new("cmd");
    c.args(["/C", program, arg]);
    c.creation_flags(0x0800_0000);
    c
}

#[cfg(not(windows))]
fn start(program: &str, arg: &str) -> Command {
    let mut c = Command::new(program);
    c.arg(arg);
    c
}

/// What the program printed when asked for its version, or `None` when it is not there, fails or takes too long
fn ask(wsl: Option<&str>, program: &str, arg: &str) -> Option<String> {
    let mut command = match wsl {
        Some(d) => start_in(d, program, arg),
        None => start(program, arg),
    };
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(command.output());
    });
    let out = rx.recv_timeout(ASK_TIMEOUT).ok()?.ok()?;
    if !out.status.success() {
        return None;
    }
    // Java prints its version on the error stream
    Some(format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

/// The first `1`, `1.2` or `1.2.3` in the text
pub fn parse_version(text: &str) -> Option<Vec<u64>> {
    let start = text.find(|c: char| c.is_ascii_digit())?;
    let v: Vec<u64> = text[start..].split(|c: char| !(c.is_ascii_digit() || c == '.')).next()?.split('.').filter(|p| !p.is_empty()).filter_map(|p| p.parse().ok()).take(3).collect();
    (!v.is_empty()).then_some(v)
}

fn cmp(a: &[u64], b: &[u64]) -> std::cmp::Ordering {
    (0..3).map(|i| a.get(i).copied().unwrap_or(0).cmp(&b.get(i).copied().unwrap_or(0))).find(|o| o.is_ne()).unwrap_or(std::cmp::Ordering::Equal)
}

/// Whether `found` is a version the range accepts. Understands `>=1.2`, `>`, `<=`, `<`, `=`, `^1.2.3`, `~1.2`, `1`, `1.2`, `1.x`, `*`,
/// several of them separated by spaces (all must hold) or by `||` (any may hold). A range it cannot read accepts anything.
pub fn satisfies(found: &[u64], range: &str) -> bool {
    let range = range.trim();
    if range.is_empty() || range == "*" {
        return true;
    }
    range.split("||").any(|alt| {
        let mut parts = alt.split_whitespace().peekable();
        let mut ok = true;
        while let Some(p) = parts.next() {
            // ">= 18" written with a space is one comparator
            let p = if matches!(p, ">=" | "<=" | ">" | "<" | "=" | "^" | "~") { format!("{p}{}", parts.next().unwrap_or("")) } else { p.to_string() };
            ok &= one(found, &p);
        }
        ok
    })
}

fn one(found: &[u64], c: &str) -> bool {
    let (op, rest) = ["<=", ">=", "<", ">", "=", "^", "~"].iter().find_map(|op| c.strip_prefix(op).map(|r| (*op, r))).unwrap_or(("", c));
    let rest = rest.trim().trim_start_matches('v');
    if rest.is_empty() || rest == "*" {
        return true;
    }
    // `1.x` and `1.2.x` hold the digits before the x
    let want: Vec<u64> = rest.split('.').take_while(|p| !matches!(*p, "x" | "X" | "*")).filter_map(|p| p.parse().ok()).collect();
    if want.is_empty() {
        return true;
    }
    match op {
        ">=" => cmp(found, &want).is_ge(),
        ">" => cmp(found, &want).is_gt(),
        "<=" => cmp(found, &want).is_le(),
        "<" => cmp(found, &want).is_lt(),
        "^" => cmp(found, &want).is_ge() && found.first() == want.first(),
        "~" => cmp(found, &want).is_ge() && found.first() == want.first() && (want.len() < 2 || found.get(1) == want.get(1)),
        // A bare version names the parts it gives: `20` is any 20.x.x
        _ => want.iter().enumerate().all(|(i, w)| found.get(i).copied().unwrap_or(0) == *w),
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub name: String,
    pub range: String,
    pub found: Option<String>,
    /// `ok`, `old` (here, but not a version the project accepts), `missing`, or `unknown` (not a program the Doctor starts)
    pub state: &'static str,
    pub url: Option<&'static str>,
}

fn status(tool: &ToolReq, output: impl Fn(&Known) -> Option<String>) -> ToolStatus {
    let Some(known) = KNOWN.iter().find(|k| k.name == tool.name) else {
        return ToolStatus { name: tool.name.clone(), range: tool.range.clone(), found: None, state: "unknown", url: None };
    };
    let text = output(known);
    let version = text.as_deref().and_then(parse_version);
    let (found, state) = match (&text, &version) {
        (None, _) => (None, "missing"),
        (Some(_), None) => (Some("installed".to_string()), "ok"),
        (Some(_), Some(v)) => (Some(v.iter().map(u64::to_string).collect::<Vec<_>>().join(".")), if satisfies(v, &tool.range) { "ok" } else { "old" }),
    };
    ToolStatus { name: tool.name.clone(), range: tool.range.clone(), found, state, url: Some(known.url) }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Doctor {
    pub tools: Vec<ToolStatus>,
    /// Version managers found on this device
    pub managers: Vec<String>,
}

/// Checks each tool of the list against this device
pub fn check(tools: &[ToolReq], wsl: Option<&str>) -> Doctor {
    let tools = tools
        .iter()
        .map(|t| status(t, |k| k.programs.iter().find_map(|p| ask(wsl, p, k.arg))))
        .collect();
    let managers = MANAGERS.iter().filter(|(p, a)| ask(wsl, p, a).is_some()).map(|(p, _)| p.to_string()).collect();
    Doctor { tools, managers }
}

/// Checks this device against a project's tools; run off the main thread because each program is started
#[tauri::command]
pub async fn project_doctor(app_handle: tauri::AppHandle, path: String, tools: Vec<ToolReq>, wsl: Option<String>) -> Result<Doctor, String> {
    validate_allowed_root(&app_handle, &path)?;
    if wsl.as_deref().is_some_and(|d| !super::project_runtime::valid_distro(d)) {
        return Err("That is not a distribution name.".to_string());
    }
    if tools.len() > 40 {
        return Err("Too many tools to check.".to_string());
    }
    tokio::task::spawn_blocking(move || check(&tools, wsl.as_deref())).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Vec<u64> {
        parse_version(s).unwrap()
    }

    #[test]
    fn versions_are_found_in_what_programs_print() {
        assert_eq!(v("v20.11.1\n"), [20, 11, 1]);
        assert_eq!(v("Python 3.12.4"), [3, 12, 4]);
        assert_eq!(v("go version go1.22.3 windows/amd64"), [1, 22, 3]);
        assert_eq!(v("openjdk version \"21.0.2\" 2024-01-16"), [21, 0, 2]);
        assert_eq!(v("cargo 1.78.0 (54d8815d0 2024-03-26)"), [1, 78, 0]);
        assert!(parse_version("no digits").is_none());
    }

    #[test]
    fn ranges_are_read_the_way_teams_write_them() {
        let node = v("20.11.1");
        for (range, ok) in [
            ("", true), ("*", true), (">=18", true), (">=21", false), (">= 18", true), ("^20.2", true), ("^21", false), ("~20.11", true), ("~20.10", false),
            ("20", true), ("18", false), ("20.11", true), ("20.x", true), ("18.x || 20.x", true), (">=18 <20", false), (">=18 <21", true), ("<20", false), ("=20.11.1", true),
            ("lts/*", true),
        ] {
            assert_eq!(satisfies(&node, range), ok, "{range}");
        }
    }

    #[test]
    fn a_tool_is_ok_old_missing_or_unknown_and_an_unknown_one_is_never_started() {
        let tool = |name: &str, range: &str| ToolReq { name: name.into(), range: range.into() };
        let ran = std::cell::Cell::new(0);
        let said = |text: &'static str| move |_: &Known| Some(text.to_string());
        assert_eq!(status(&tool("node", ">=18"), said("v20.1.0")).state, "ok");
        assert_eq!(status(&tool("node", ">=22"), said("v20.1.0")).state, "old");
        assert_eq!(status(&tool("node", ""), |_| None).state, "missing");
        let unknown = status(&tool("rm -rf", ""), |_| {
            ran.set(ran.get() + 1);
            Some("1".into())
        });
        assert_eq!((unknown.state, ran.get()), ("unknown", 0));
    }
}
