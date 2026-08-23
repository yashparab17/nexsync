// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Application entry point
fn main() {
    nexsync_lib::run()
}
