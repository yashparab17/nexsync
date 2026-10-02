//! Update checks with two channels. Stable follows the newest published release; beta follows a `latest.json` that
//! the maintainers point at a pre-release, so testers get builds earlier. Both are signed with the same key, which the
//! app checks before installing anything.

use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;

const STABLE: &str = "https://github.com/yashparab17/nexsync/releases/latest/download/latest.json";
const BETA: &str = "https://github.com/yashparab17/nexsync/releases/download/beta/latest.json";

/// What the Settings page shows about an update that is waiting
#[derive(Debug, Serialize, PartialEq)]
pub struct UpdateInfo {
    pub version: String,
    /// The release notes written on the release, if there are any
    pub notes: Option<String>,
    pub date: Option<String>,
}

fn endpoint(channel: &str) -> Result<url::Url, String> {
    let address = match channel {
        "stable" => STABLE,
        "beta" => BETA,
        other => return Err(format!("Unknown update channel \"{other}\".")),
    };
    url::Url::parse(address).map_err(|e| e.to_string())
}

fn updater(app: &tauri::AppHandle, channel: &str) -> Result<tauri_plugin_updater::Updater, String> {
    app.updater_builder()
        .endpoints(vec![endpoint(channel)?])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

/// Looks on the chosen channel for a newer signed build
#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle, channel: String) -> Result<Option<UpdateInfo>, String> {
    let found = updater(&app, &channel)?.check().await.map_err(|e| e.to_string())?;
    Ok(found.map(|u| UpdateInfo { version: u.version, notes: u.body, date: u.date.map(|d| d.to_string()) }))
}

/// Downloads and installs the newer build from the chosen channel; the frontend restarts the app afterwards
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, channel: String) -> Result<(), String> {
    let update = updater(&app, &channel)?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "There is no update to install.".to_string())?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_each_channel_has_its_own_address_and_others_are_refused() {
        let stable = endpoint("stable").unwrap();
        let beta = endpoint("beta").unwrap();
        assert_ne!(stable, beta);
        assert!(stable.path().ends_with("/latest/download/latest.json"));
        assert!(beta.path().contains("/download/beta/"));
        assert!(endpoint("nightly").is_err());
        assert!(endpoint("").is_err());
    }
}
