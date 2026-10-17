//! Where a project's tasks run on this device (Phase 20, step 8): on the system itself, or inside a Windows Subsystem for Linux
//! distribution, for the many teams whose Node, Python or Rust tooling lives there.
//!
//! The choice belongs to the device, not to the project: a teammate on macOS has no WSL, and a recipe is text from other people.
//! So it is kept in `.nexsync/project-runtime.json` here and never in the recipe, and approving a task covers the project's command
//! whichever runtime this device runs it on. Ports a program opens inside WSL are forwarded to Windows by WSL itself.
//!
//! Limits: stopping a task ends `wsl.exe`; a program the task left running inside the distribution may need `Stop All` and a
//! look with `ps`. Not tried against a real distribution on the machine this was written on (none was installed): the pieces that
//! decode, convert and build the command have tests; the run itself is the part to try first.

use std::{collections::HashMap, fs, path::Path};

use serde::{Deserialize, Serialize};

use super::projects::project_dir;
use crate::commands::{config::validate_allowed_root, editor_run::Runtime};

fn file(workspace: &str) -> std::path::PathBuf {
    Path::new(workspace).join(".nexsync").join("project-runtime.json")
}

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
struct Choice {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    wsl: Option<String>,
}

fn load(workspace: &str) -> HashMap<String, Choice> {
    fs::read_to_string(file(workspace)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// The names `wsl.exe -l -q` printed: it writes UTF-16 with a byte-order mark, one name per line. Docker's own helper
/// distributions are left out; nothing is meant to run in them.
pub fn decode_distros(bytes: &[u8]) -> Vec<String> {
    let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
    let text = String::from_utf16_lossy(&units);
    text.trim_start_matches('\u{feff}')
        .lines()
        .map(|l| l.trim().trim_matches('\0').to_string())
        .filter(|l| !l.is_empty() && !l.starts_with("docker-desktop"))
        .collect()
}

/// A distribution name is letters, digits, dots, dashes and underscores; anything else is never put on a command line
pub fn valid_distro(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// `E:\work\app` as the default mount sees it: `/mnt/e/work/app`. Used when asking the distribution (`wslpath`) fails.
pub fn mnt_path(windows: &str) -> String {
    let p = windows.trim_start_matches(r"\\?\").replace('\\', "/");
    match p.as_bytes() {
        [d, b':', ..] if d.is_ascii_alphabetic() => format!("/mnt/{}{}", (*d as char).to_ascii_lowercase(), &p[2..]),
        _ => p,
    }
}

#[cfg(windows)]
fn wsl(args: &[&str]) -> Option<Vec<u8>> {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("wsl.exe").args(args).creation_flags(0x0800_0000).stdin(std::process::Stdio::null()).output().ok()?;
    out.status.success().then_some(out.stdout)
}

#[cfg(not(windows))]
fn wsl(_: &[&str]) -> Option<Vec<u8>> {
    None
}

/// The distributions installed on this device (empty off Windows, or when WSL is not there)
pub fn distros() -> Vec<String> {
    wsl(&["-l", "-q"]).map(|b| decode_distros(&b)).unwrap_or_default()
}

/// The folder as the distribution sees it
pub fn path_in(distro: &str, windows: &Path) -> String {
    let win = windows.to_string_lossy().trim_start_matches(r"\\?\").to_string();
    wsl(&["-d", distro, "wslpath", "-a", "-u", &win]).and_then(|b| String::from_utf8(b).ok()).map(|s| s.trim().to_string()).filter(|s| s.starts_with('/')).unwrap_or_else(|| mnt_path(&win))
}

/// The runtime this device chose for a project, for a task that starts in `cwd`
pub fn runtime_for(workspace: &str, project: &str, cwd: &Path) -> Runtime {
    match load(workspace).get(project).and_then(|c| c.wsl.clone()) {
        Some(distro) if cfg!(windows) && valid_distro(&distro) => {
            let cwd = path_in(&distro, cwd);
            Runtime::Wsl { distro, cwd }
        }
        _ => Runtime::Local,
    }
}

/// The distribution a project's tasks run in on this device, if one was chosen
pub fn wsl_of(workspace: &str, project: &str) -> Option<String> {
    load(workspace).get(project).and_then(|c| c.wsl.clone()).filter(|d| cfg!(windows) && valid_distro(d))
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    /// Distributions installed here
    pub distros: Vec<String>,
    /// The one this project's tasks use, or `None` for this system
    pub wsl: Option<String>,
}

#[tauri::command]
pub async fn project_runtime(app_handle: tauri::AppHandle, path: String, project: String) -> Result<RuntimeInfo, String> {
    validate_allowed_root(&app_handle, &path)?;
    project_dir(&path, &project)?;
    let distros = tokio::task::spawn_blocking(distros).await.map_err(|e| e.to_string())?;
    Ok(RuntimeInfo { wsl: wsl_of(&path, &project).filter(|d| distros.contains(d)), distros })
}

/// Chooses where this device runs a project's tasks: a distribution that is installed, or `None` for this system
#[tauri::command]
pub async fn project_runtime_set(app_handle: tauri::AppHandle, path: String, project: String, wsl: Option<String>) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    project_dir(&path, &project)?;
    if let Some(d) = &wsl {
        let known = tokio::task::spawn_blocking(distros).await.map_err(|e| e.to_string())?;
        if !valid_distro(d) || !known.contains(d) {
            return Err("That distribution is not installed on this device.".to_string());
        }
    }
    let mut all = load(&path);
    if wsl.is_some() {
        all.insert(project, Choice { wsl });
    } else {
        all.remove(&project);
    }
    fs::create_dir_all(Path::new(&path).join(".nexsync")).map_err(|e| e.to_string())?;
    fs::write(file(&path), serde_json::to_string(&all).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(s: &str) -> Vec<u8> {
        std::iter::once(0xfeffu16).chain(s.encode_utf16()).flat_map(u16::to_le_bytes).collect()
    }

    #[test]
    fn the_list_wsl_prints_is_read_as_utf16_and_helpers_are_left_out() {
        assert_eq!(decode_distros(&utf16("Ubuntu-24.04\r\ndocker-desktop\r\nDebian\r\n\r\n")), ["Ubuntu-24.04", "Debian"]);
        assert!(decode_distros(&[]).is_empty());
    }

    #[test]
    fn a_windows_folder_becomes_the_mounted_one_and_names_stay_plain() {
        assert_eq!(mnt_path(r"E:\MSC CS Material\app"), "/mnt/e/MSC CS Material/app");
        assert_eq!(mnt_path(r"\\?\C:\x"), "/mnt/c/x");
        assert_eq!(mnt_path("/already/unix"), "/already/unix");
        assert!(valid_distro("Ubuntu-24.04") && !valid_distro("a b") && !valid_distro("x;y") && !valid_distro(""));
    }

    #[test]
    fn the_command_is_passed_as_one_argument_after_the_shell() {
        let args = crate::commands::editor_run::wsl_args("Ubuntu", "/mnt/e/app", "npm run dev && echo \"done\"");
        assert_eq!(args, ["-d", "Ubuntu", "--cd", "/mnt/e/app", "--", "sh", "-lc", "npm run dev && echo \"done\""]);
    }

    #[test]
    fn a_choice_is_kept_per_project_and_a_stranger_in_the_file_is_not_a_distribution() {
        let ws = std::env::temp_dir().join(format!("nexsync-runtime-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(ws.join(".nexsync")).unwrap();
        let w = ws.to_str().unwrap();
        fs::write(file(w), r#"{"app":{"wsl":"Ubuntu"},"evil":{"wsl":"x; rm -rf /"}}"#).unwrap();
        assert_eq!(runtime_for(w, "other", &ws), Runtime::Local);
        assert_eq!(runtime_for(w, "evil", &ws), Runtime::Local);
        assert_eq!(wsl_of(w, "evil"), None);
        // On other systems than Windows the choice is ignored
        assert_eq!(wsl_of(w, "app").is_some(), cfg!(windows));
        let _ = fs::remove_dir_all(&ws);
    }
}
