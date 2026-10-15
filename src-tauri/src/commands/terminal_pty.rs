//! A shell running in a pseudo-terminal, with no knowledge of Tauri so it can be tested on its own.

use std::{
    io::{Read, Write},
    path::Path,
    sync::Mutex,
};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};

pub struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

/// A shell that can be opened in a terminal
#[derive(Clone, Debug, serde::Serialize)]
pub struct Shell {
    /// Stable name the panel sends back: `powershell`, `cmd`, ... on Windows, the full path elsewhere
    pub id: String,
    pub name: String,
    pub path: String,
}

fn shell(id: &str, name: &str, path: impl Into<String>) -> Shell {
    Shell { id: id.into(), name: name.into(), path: path.into() }
}

/// Shells found on this machine; the first is the default
pub fn shells() -> Vec<Shell> {
    let mut found = Vec::new();
    #[cfg(windows)]
    {
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let exists = |p: &str| Path::new(p).is_file();
        let ps = format!(r"{root}\System32\WindowsPowerShell\v1.0\powershell.exe");
        if exists(&ps) {
            found.push(shell("powershell", "Windows PowerShell", ps));
        }
        for dir in std::env::var("PATH").unwrap_or_default().split(';') {
            let pwsh = format!(r"{dir}\pwsh.exe");
            if !dir.is_empty() && exists(&pwsh) {
                found.push(shell("pwsh", "PowerShell 7", pwsh));
                break;
            }
        }
        found.push(shell("cmd", "Command Prompt", std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())));
        for base in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            let Ok(base) = std::env::var(base) else { continue };
            for tail in [r"\Git\bin\bash.exe", r"\Programs\Git\bin\bash.exe"] {
                let bash = format!("{base}{tail}");
                if exists(&bash) && !found.iter().any(|s| s.id == "gitbash") {
                    found.push(shell("gitbash", "Git Bash", bash));
                }
            }
        }
        let wsl = format!(r"{root}\System32\wsl.exe");
        if exists(&wsl) {
            found.push(shell("wsl", "WSL", wsl));
        }
    }
    #[cfg(not(windows))]
    {
        let mut paths: Vec<String> = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).into_iter().collect();
        if let Ok(list) = std::fs::read_to_string("/etc/shells") {
            paths.extend(list.lines().map(str::trim).filter(|l| l.starts_with('/')).map(String::from));
        }
        for path in paths {
            let name = path.rsplit('/').next().unwrap_or(&path).to_string();
            // /bin/bash and /usr/bin/bash are one shell to the person choosing; nologin and the like are not shells
            if name.contains("nologin") || name == "false" || found.iter().any(|s: &Shell| s.name == name) || !Path::new(&path).is_file() {
                continue;
            }
            found.push(shell(&path, &name, path.clone()));
        }
        if found.is_empty() {
            found.push(shell("sh", "sh", "sh"));
        }
    }
    found
}

/// The command for a shell, started the way each one expects: PowerShell without its banner and with a prompt that shows
/// only the folder, `cmd` prompting with the folder, Git Bash as a login shell, others as login shells as well so PATH and
/// the profile are what the user expects
fn shell_command(choice: Option<&str>) -> CommandBuilder {
    let all = shells();
    let chosen = choice.and_then(|id| all.iter().find(|s| s.id == id)).or(all.first()).cloned().unwrap_or_else(|| shell("sh", "sh", "sh"));
    let stem = Path::new(&chosen.path.replace('\\', "/")).file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mut cmd = CommandBuilder::new(&chosen.path);
    match stem.as_str() {
        "powershell" | "pwsh" => {
            cmd.args(["-NoLogo", "-NoExit", "-Command", "function prompt { (Get-Location).ProviderPath + '> ' }"]);
        }
        "cmd" => {
            cmd.args(["/K", "prompt $P$G"]);
        }
        "wsl" => {}
        "bash" if chosen.id == "gitbash" => {
            cmd.args(["--login", "-i"]);
        }
        _ => {
            cmd.arg("-l");
        }
    }
    cmd
}

/// Windows spells a canonical path `\\?\E:\folder`, which shells show as `Microsoft.PowerShell.Core\FileSystem::\\?\E:\...`;
/// this gives the plain `E:\folder` (network paths `\\?\UNC\server\share` become `\\server\share`)
pub fn plain_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        path.to_string()
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.clamp(1, 500), cols: cols.clamp(1, 1000), pixel_width: 0, pixel_height: 0 }
}

impl PtySession {
    /// Starts a shell in `cwd`. `on_data` gets everything it prints, as raw bytes in the order written; `on_exit` is
    /// called once when the shell ends, with its exit code when it has one.
    pub fn spawn(
        cwd: &Path,
        cols: u16,
        rows: u16,
        shell: Option<&str>,
        on_data: impl Fn(&[u8]) + Send + 'static,
        on_exit: impl FnOnce(Option<u32>) + Send + 'static,
    ) -> Result<Self, String> {
        let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| format!("Could not open a terminal: {e}"))?;
        let mut cmd = shell_command(shell);
        cmd.cwd(plain_path(&cwd.to_string_lossy()));
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("Could not start the shell: {e}"))?;
        // The slave end must be closed here, or the reader never sees the shell exit
        drop(pair.slave);
        let killer = child.clone_killer();
        let mut reader = pair.master.try_clone_reader().map_err(|e| format!("Could not read the terminal: {e}"))?;
        let writer = pair.master.take_writer().map_err(|e| format!("Could not write to the terminal: {e}"))?;

        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => on_data(&buf[..n]),
                }
            }
            let code = child.wait().ok().map(|s| s.exit_code());
            on_exit(code);
        });

        Ok(Self { master: Mutex::new(pair.master), writer: Mutex::new(writer), killer: Mutex::new(killer) })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut writer = self.writer.lock().unwrap_or_else(|p| p.into_inner());
        writer.write_all(data).and_then(|_| writer.flush()).map_err(|e| e.to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master.lock().unwrap_or_else(|p| p.into_inner()).resize(size(cols, rows)).map_err(|e| e.to_string())
    }

    pub fn kill(&self) {
        let _ = self.killer.lock().unwrap_or_else(|p| p.into_inner()).kill();
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.kill();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    #[test]
    fn test_a_shell_runs_commands_and_ends() {
        let out = Arc::new(Mutex::new(Vec::<u8>::new()));
        let (tx, rx) = mpsc::channel();
        let sink = out.clone();
        let session = PtySession::spawn(
            &std::env::temp_dir(),
            80,
            24,
            None,
            move |b| sink.lock().unwrap().extend_from_slice(b),
            move |code| tx.send(code).unwrap(),
        )
        .unwrap();
        session.resize(100, 30).unwrap();
        session.write(b"echo nexsync-$((6*7))\nexit 3\n").unwrap();
        let code = rx.recv_timeout(Duration::from_secs(10)).expect("the shell should exit");
        assert_eq!(code, Some(3));
        let text = String::from_utf8_lossy(&out.lock().unwrap()).to_string();
        assert!(text.contains("nexsync-42"), "{text:?}");
    }

    #[test]
    fn test_shells_are_found_and_unique() {
        let all = shells();
        assert!(!all.is_empty());
        let mut names: Vec<_> = all.iter().map(|s| s.name.clone()).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), all.len());
    }

    #[test]
    fn test_a_chosen_shell_is_the_one_started() {
        let Some(sh) = shells().into_iter().find(|s| s.name == "sh") else { return };
        let (tx, rx) = mpsc::channel();
        let out = Arc::new(Mutex::new(Vec::<u8>::new()));
        let sink = out.clone();
        let s = PtySession::spawn(&std::env::temp_dir(), 80, 24, Some(&sh.id), move |b| sink.lock().unwrap().extend_from_slice(b), move |c| tx.send(c).unwrap()).unwrap();
        s.write(b"echo picked-$0\nexit\n").unwrap();
        rx.recv_timeout(Duration::from_secs(10)).unwrap();
        assert!(String::from_utf8_lossy(&out.lock().unwrap()).contains("picked-"));
    }

    #[test]
    fn test_verbatim_paths_are_made_plain() {
        assert_eq!(plain_path(r"\\?\E:\nexsynctest\Test 123\editor"), r"E:\nexsynctest\Test 123\editor");
        assert_eq!(plain_path(r"\\?\UNC\server\share\x"), r"\\server\share\x");
        assert_eq!(plain_path("/home/user/editor"), "/home/user/editor");
    }

    #[test]
    fn test_killing_ends_the_shell() {
        let (tx, rx) = mpsc::channel();
        let session = PtySession::spawn(&std::env::temp_dir(), 80, 24, None, |_| {}, move |code| tx.send(code).unwrap()).unwrap();
        session.kill();
        assert!(rx.recv_timeout(Duration::from_secs(10)).is_ok());
    }
}
