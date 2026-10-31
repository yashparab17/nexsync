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
    }

    nexsync_lib::run()
}
