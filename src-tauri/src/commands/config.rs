use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use serde::{Deserialize, Serialize};

/// Configuration file path in the app-data directory.
const CONFIG_FILE_NAME: &str = "nexsync_config.json";

/// Configuration for Nexsync security settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NexsyncConfig {
    /// Allowed root directories for workspace creation/import.
    /// Users can add their own paths to this list (e.g., Documents, Desktop, custom folders).
    pub allowed_workspace_roots: Vec<String>,
}

impl Default for NexsyncConfig {
    fn default() -> Self {
        // By default, allow user's Documents and Desktop folders on most platforms
        let mut defaults = vec![
            "Documents".to_string(),
            "Desktop".to_string(),
        ];

        // Add platform-specific defaults
        #[cfg(windows)]
        {
            defaults.extend_from_slice(&["My Documents".to_string(), "Documents".to_string()]);
        }

        #[cfg(target_os = "macos")]
        {
            defaults.push("~/Documents".to_string());
        }

        #[cfg(not(any(windows, target_os = "macos", unix)))]
        {
            // Unknown platform - start with minimal safe defaults
            defaults.clear();
        }

        Self {
            allowed_workspace_roots: defaults,
        }
    }
}

/// Get the path to the configuration file in app-data directory.
pub fn config_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    Ok(app_data.join("nexsync").join(CONFIG_FILE_NAME))
}

/// Ensure the config directory exists and return the config path.
fn ensure_config_dir(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let config_dir = config_path(app_handle)?
        .parent()
        .ok_or("Invalid config path")?
        .to_path_buf();
    
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    Ok(())
}

/// Load the current configuration from disk.
pub fn load_config(app_handle: &tauri::AppHandle) -> Result<NexsyncConfig, String> {
    ensure_config_dir(app_handle)?;
    let config_file = config_path(app_handle)?;
    
    if !config_file.exists() {
        return Ok(NexsyncConfig::default());
    }
    
    let content = fs::read_to_string(&config_file)
        .map_err(|e| format!("Failed to read config file: {}", e))?;
    
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config file: {}", e))
}

/// Save the configuration to disk.
pub fn save_config(app_handle: &tauri::AppHandle, config: &NexsyncConfig) -> Result<(), String> {
    ensure_config_dir(app_handle)?;
    let config_file = config_path(app_handle)?;
    
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    
    fs::write(&config_file, content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;
    
    Ok(())
}

/// Resolve an expanded path (~ to home dir, etc.) to an absolute canonical path.
pub fn expand_and_resolve(path: &str) -> Result<PathBuf, String> {
    let path = path.trim();
    
    // Handle tilde expansion
    let expanded = if path.starts_with("~/") || path == "~" {
        dirs::home_dir()
            .ok_or_else(|| "Could not resolve home directory".to_string())?
            .join(path.trim_start_matches('~'))
    } else {
        PathBuf::from(path)
    };
    
    // Try to canonicalize; if it doesn't exist, at least normalize it
    match expanded.canonicalize() {
        Ok(p) => Ok(p),
        Err(_) => {
            // Directory may not exist yet - just normalize
            Ok(expanded)
        }
    }
}

/// Validate that a workspace path is within the allowed roots.
/// This enforces C3: Restricting workspace operations to safe directories.
pub fn validate_allowed_root(
    app_handle: &tauri::AppHandle,
    workspace_path: &str,
) -> Result<(), String> {
    let config = load_config(app_handle)?;
    
    // If allowed_workspace_roots is empty, fall back to checking common safe locations
    if config.allowed_workspace_roots.is_empty() {
        return check_default_safe_paths(workspace_path);
    }
    
    let candidate = expand_and_resolve(workspace_path)?;
    
    for root_template in &config.allowed_workspace_roots {
        let root = expand_and_resolve(root_template)?;
        
        if candidate.starts_with(&root) {
            return Ok(());
        }
    }
    
    Err(format!(
        "Workspace path '{}' is not within any allowed root directory. \
         Please configure allowed roots or use standard folders (Documents, Desktop).",
        candidate.display()
    ))
}

/// Check if the path is in one of the platform-default safe locations.
/// 
/// This is a fallback when allowed_workspace_roots is empty or not configured.
/// The default behavior is to allow any path within the user's home directory.
fn check_default_safe_paths(path: &str) -> Result<(), String> {
    let candidate = expand_and_resolve(path)?;
    let home = dirs::home_dir()
        .ok_or_else(|| "Could not resolve home directory for validation".to_string())?;
    
    // Allow paths under the home directory
    // This includes Documents, Desktop, Downloads, etc.
    // but blocks system directories like /usr, C:\Windows, C:\Program Files
    if candidate.starts_with(&home) {
        return Ok(());
    }
    
    Err(format!(
        "Workspace path '{}' is outside your home directory ({}) which is considered unsafe. \
         Please use folders within your home directory (Documents, Desktop, etc.).",
        candidate.display(),
        home.display()
    ))
}

/// Tauri command wrapper to load config
#[tauri::command]
pub fn load_config_cmd(app_handle: tauri::AppHandle) -> Result<NexsyncConfig, String> {
    load_config(&app_handle)
}

/// Tauri command wrapper to save config
#[tauri::command]
pub fn save_config_cmd(
    app_handle: tauri::AppHandle,
    config: NexsyncConfig,
) -> Result<(), String> {
    save_config(&app_handle, &config)
}

/// Tauri command wrapper to validate allowed root
#[tauri::command]
pub fn validate_allowed_root_cmd(
    app_handle: tauri::AppHandle,
    workspace_path: String,
) -> Result<bool, String> {
    match validate_allowed_root(&app_handle, &workspace_path) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config_created() {
        let config = NexsyncConfig::default();
        assert!(!config.allowed_workspace_roots.is_empty());
    }

    #[test]
    fn test_expand_tilde() {
        // This test may fail if no home directory is found, so we handle gracefully
        match expand_and_resolve("~/test") {
            Ok(path) => {
                assert!(path.is_absolute());
                assert!(path.to_string_lossy().contains("test"));
            }
            Err(_) => {} // Acceptable if no home directory
        }
    }
}