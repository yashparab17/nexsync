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

/// The user's own shell: `$SHELL`, falling back to `sh`; on Windows, PowerShell without its banner and with a prompt that
/// shows only the folder (falling back to `cmd`, which already prompts with the folder)
fn shell_command() -> CommandBuilder {
    #[cfg(windows)]
    {
        if let Some(powershell) = which_powershell() {
            let mut cmd = CommandBuilder::new(powershell);
            cmd.args(["-NoLogo", "-NoExit", "-Command", "function prompt { (Get-Location).ProviderPath + '> ' }"]);
            return cmd;
        }
        let mut cmd = CommandBuilder::new(std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()));
        cmd.args(["/K", "prompt $P$G"]);
        cmd
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "sh".into());
        let mut cmd = CommandBuilder::new(shell);
        // A login shell, as a terminal app opens one, so PATH and the user's profile are what they expect
        cmd.arg("-l");
        cmd
    }
}

#[cfg(windows)]
fn which_powershell() -> Option<String> {
    let root = std::env::var("SystemRoot").ok()?;
    let path = format!(r"{root}\System32\WindowsPowerShell\v1.0\powershell.exe");
    Path::new(&path).is_file().then_some(path)
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
        on_data: impl Fn(&[u8]) + Send + 'static,
        on_exit: impl FnOnce(Option<u32>) + Send + 'static,
    ) -> Result<Self, String> {
        let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| format!("Could not open a terminal: {e}"))?;
        let mut cmd = shell_command();
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
    fn test_verbatim_paths_are_made_plain() {
        assert_eq!(plain_path(r"\\?\E:\nexsynctest\Test 123\editor"), r"E:\nexsynctest\Test 123\editor");
        assert_eq!(plain_path(r"\\?\UNC\server\share\x"), r"\\server\share\x");
        assert_eq!(plain_path("/home/user/editor"), "/home/user/editor");
    }

    #[test]
    fn test_killing_ends_the_shell() {
        let (tx, rx) = mpsc::channel();
        let session = PtySession::spawn(&std::env::temp_dir(), 80, 24, |_| {}, move |code| tx.send(code).unwrap()).unwrap();
        session.kill();
        assert!(rx.recv_timeout(Duration::from_secs(10)).is_ok());
    }
}
