//! Configuration management for allowed workspace storage directories.

use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use serde::{Deserialize, Serialize};

/// Configuration file path in the app-data directory
const CONFIG_FILE_NAME: &str = "nexsync_config.json";

/// Configuration for Nexsync security settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NexsyncConfig {
    /// Allowed root directories for workspace creation/import
    pub allowed_workspace_roots: Vec<String>,
}

impl Default for NexsyncConfig {
    fn default() -> Self {
        let mut defaults = Vec::new();

        if let Some(doc_dir) = dirs::document_dir() {
            defaults.push(doc_dir.to_string_lossy().to_string());
        }
        if let Some(desk_dir) = dirs::desktop_dir() {
            defaults.push(desk_dir.to_string_lossy().to_string());
        }

        if defaults.is_empty() {
            if let Some(home_dir) = dirs::home_dir() {
                defaults.push(home_dir.to_string_lossy().to_string());
            }
        }

        Self {
            allowed_workspace_roots: defaults,
        }
    }
}

/// Returns the configuration file path in the app data directory
pub fn config_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    Ok(app_data.join("nexsync").join(CONFIG_FILE_NAME))
}

/// Ensures the config directory exists
fn ensure_config_dir(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let config_dir = config_path(app_handle)?
        .parent()
        .ok_or("Invalid config path")?
        .to_path_buf();
    
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    Ok(())
}

/// Loads configuration from disk, falling back to defaults if not found
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

/// Validates that an allowed root candidate is safe and not a system directory
fn validate_root_candidate(root: &str) -> Result<PathBuf, String> {
    let path = expand_and_resolve(root)?;
    if !path.is_absolute() {
        return Err(format!("Allowed root path '{}' must be absolute.", root));
    }

    let path_str = path.to_string_lossy();
    // Reject drive roots
    if path_str == "/" || path_str == "\\" || path_str.ends_with(":\\") || path_str.ends_with(":/") {
        return Err(format!("Root directory '{}' cannot be configured as a workspace root.", root));
    }

    #[cfg(windows)]
    {
        let lower = path_str.to_lowercase();
        if lower.starts_with("c:\\windows") || lower.starts_with("c:\\program files") || lower.starts_with("c:\\program files (x86)") {
            return Err("System directories cannot be added as allowed workspace roots.".to_string());
        }
    }

    #[cfg(unix)]
    {
        if path_str.starts_with("/etc") || path_str.starts_with("/usr") || path_str.starts_with("/var") || path_str.starts_with("/bin") || path_str.starts_with("/sbin") {
            return Err("System directories cannot be added as allowed workspace roots.".to_string());
        }
    }

    Ok(path)
}

/// Saves the configuration to disk after validating root candidates
pub fn save_config(app_handle: &tauri::AppHandle, config: &NexsyncConfig) -> Result<(), String> {
    for root in &config.allowed_workspace_roots {
        validate_root_candidate(root)?;
    }

    ensure_config_dir(app_handle)?;
    let config_file = config_path(app_handle)?;
    
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    
    fs::write(&config_file, content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;
    
    Ok(())
}

/// Resolves home directory tilde and normalizes path
pub fn expand_and_resolve(path: &str) -> Result<PathBuf, String> {
    let path = path.trim();
    
    let expanded = if path.starts_with("~/") || path == "~" {
        dirs::home_dir()
            .ok_or_else(|| "Could not resolve home directory".to_string())?
            .join(path.trim_start_matches('~'))
    } else {
        PathBuf::from(path)
    };
    
    match expanded.canonicalize() {
        Ok(p) => Ok(p),
        Err(_) => Ok(expanded),
    }
}

/// Validates that a workspace path resides within allowed directory roots
pub fn validate_allowed_root(
    app_handle: &tauri::AppHandle,
    workspace_path: &str,
) -> Result<(), String> {
    let config = load_config(app_handle)?;
    
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
        "Workspace path '{}' is not within any allowed root directory.",
        candidate.display()
    ))
}

/// Fallback check against user home directory
fn check_default_safe_paths(path: &str) -> Result<(), String> {
    let candidate = expand_and_resolve(path)?;
    let home = dirs::home_dir()
        .ok_or_else(|| "Could not resolve home directory for validation".to_string())?;
    
    if candidate.starts_with(&home) {
        return Ok(());
    }
    
    Err(format!(
        "Workspace path '{}' is outside your home directory ({}).",
        candidate.display(),
        home.display()
    ))
}

/// Tauri command to retrieve current application config
#[tauri::command]
pub fn load_config_cmd(app_handle: tauri::AppHandle) -> Result<NexsyncConfig, String> {
    load_config(&app_handle)
}

/// Tauri command to persist application config
#[tauri::command]
pub fn save_config_cmd(
    app_handle: tauri::AppHandle,
    config: NexsyncConfig,
) -> Result<(), String> {
    save_config(&app_handle, &config)
}

/// Tauri command to check if a workspace path is allowed
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
        match expand_and_resolve("~/test") {
            Ok(path) => {
                assert!(path.is_absolute());
                assert!(path.to_string_lossy().contains("test"));
            }
            Err(_) => {}
        }
    }
}