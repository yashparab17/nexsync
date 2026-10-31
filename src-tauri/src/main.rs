// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Application entry point
fn main() {
    #[cfg(target_os = "linux")]
    {
        // WebKitGTK's web process crashes on some graphics set-ups; see `linux_graphics_env`
        for (name, value) in nexsync_lib::linux_graphics_env(&|k| std::env::var(k).ok()) {
            std::env::set_var(name, value);
        }
        // An AppImage's own Wayland/EGL/GBM libraries clash with a newer system's: start again once with the system's loaded first
        if (std::env::var_os("APPIMAGE").is_some() || std::env::var_os("APPDIR").is_some())
            && std::env::var_os("NEXSYNC_PRELOADED").is_none()
            && std::env::var_os("NEXSYNC_NO_PRELOAD").is_none()
        {
            if let Some(libs) = nexsync_lib::system_graphics_preload(&|p| std::path::Path::new(p).exists()) {
                use std::os::unix::process::CommandExt;
                let merged = match std::env::var("LD_PRELOAD") {
                    Ok(old) if !old.is_empty() => format!("{libs}:{old}"),
                    _ => libs,
                };
                // exec only returns on failure; then the app simply starts as it was
                let _ = std::process::Command::new(std::env::current_exe().unwrap_or_default())
                    .args(std::env::args_os().skip(1))
                    .env("LD_PRELOAD", merged)
                    .env("NEXSYNC_PRELOADED", "1")
                    .exec();
            }
        }
    }

    nexsync_lib::run()
}
