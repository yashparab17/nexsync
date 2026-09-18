// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Application entry point
fn main() {
    #[cfg(target_os = "linux")]
    {
        // Fix WebKitGTK hardware acceleration / GBM buffer bug on Linux
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    nexsync_lib::run()
}
