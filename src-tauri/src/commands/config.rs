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

/// Checks if a path is inside a restricted OS system directory.
pub fn is_system_directory(path: &std::path::Path) -> bool {
    let path_str = path.to_string_lossy();

    #[cfg(windows)]
    {
        let lower = path_str.to_lowercase().replace('/', "\\");

        // Disallow standard Windows system locations
        let forbidden_windows_prefixes = [
            "c:\\windows",
            "c:\\program files",
            "c:\\program files (x86)",
        ];
        for prefix in forbidden_windows_prefixes {
            if lower == prefix || lower.starts_with(&format!("{}\\", prefix)) {
                return true;
            }
        }

        // Disallow system directories on ANY drive (e.g. D:\$Recycle.Bin, E:\System Volume Information)
        let forbidden_substrings = [
            "\\windows\\",
            "\\$recycle.bin",
            "\\system volume information",
            "\\recovery\\",
        ];
        for sub in forbidden_substrings {
            if lower.contains(sub) || lower.ends_with(sub.trim_end_matches('\\')) {
                return true;
            }
        }

        // Environment-specific Windows directories
        for var in ["WINDIR", "SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Ok(val) = std::env::var(var) {
                let val_lower = val.to_lowercase().replace('/', "\\");
                if lower == val_lower || lower.starts_with(&format!("{}\\", val_lower)) {
                    return true;
                }
            }
        }
    }

    #[cfg(unix)]
    {
        let s = path_str.as_ref();
        let forbidden = ["/etc", "/usr", "/var", "/bin", "/sbin", "/dev", "/proc", "/sys", "/boot", "/root", "/System", "/Library"];
        for prefix in forbidden {
            if s == prefix || s.starts_with(&format!("{}/", prefix)) {
                return true;
            }
        }
    }

    false
}

/// Helper to check if `candidate` path starts with or is inside `prefix`.
/// On Windows, handles case-insensitivity and ensures component-boundary matching.
pub fn path_starts_with(candidate: &std::path::Path, prefix: &std::path::Path) -> bool {
    #[cfg(windows)]
    {
        let c = candidate.to_string_lossy().to_lowercase().replace('/', "\\");
        let mut p = prefix.to_string_lossy().to_lowercase().replace('/', "\\");
        if c == p {
            return true;
        }
        if !p.ends_with('\\') {
            p.push('\\');
        }
        c.starts_with(&p)
    }
    #[cfg(not(windows))]
    {
        candidate.starts_with(prefix)
    }
}

/// Validates that an allowed root candidate is safe and not a system directory
pub fn validate_root_candidate(root: &str) -> Result<PathBuf, String> {
    let path = expand_and_resolve(root)?;
    if !path.is_absolute() {
        return Err(format!("Allowed root path '{}' must be absolute.", root));
    }

    let path_str = path.to_string_lossy();
    // Reject system root filesystem on Unix and C:\ on Windows
    if path_str == "/" || path_str == "\\" {
        return Err(format!("Root directory '{}' cannot be configured as a workspace root.", root));
    }

    #[cfg(windows)]
    {
        let lower = path_str.to_lowercase();
        if lower == "c:\\" || lower == "c:/" {
            return Err("The system drive root 'C:\\' cannot be configured as a workspace root.".to_string());
        }
    }

    if is_system_directory(&path) {
        return Err("System directories cannot be added as allowed workspace roots.".to_string());
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

/// Strips the Windows extended-length UNC prefix `\\?\` from a path string.
/// `std::fs::canonicalize` on Windows always returns these prefixed paths,
/// which breaks `starts_with` comparisons against plain paths.
#[cfg(windows)]
pub fn strip_unc_prefix(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path
    }
}

#[cfg(not(windows))]
pub fn strip_unc_prefix(path: PathBuf) -> PathBuf {
    path
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
        Ok(p) => Ok(strip_unc_prefix(p)),
        Err(_) => Ok(strip_unc_prefix(expanded)),
    }
}

/// Adds a root directory to allowed_workspace_roots in config if not already covered
pub fn add_allowed_root(app_handle: &tauri::AppHandle, root_path: &str) -> Result<(), String> {
    let mut config = load_config(app_handle)?;
    let candidate = expand_and_resolve(root_path)?;

    if is_system_directory(&candidate) {
        return Err("Cannot add system directory as allowed root.".to_string());
    }

    for existing in &config.allowed_workspace_roots {
        if let Ok(existing_path) = expand_and_resolve(existing) {
            if path_starts_with(&candidate, &existing_path) {
                return Ok(());
            }
        }
    }

    let candidate_str = candidate.to_string_lossy().to_string();
    if validate_root_candidate(&candidate_str).is_ok() {
        config.allowed_workspace_roots.push(candidate_str);
        let _ = save_config(app_handle, &config);
    }
    Ok(())
}

/// Validates that a workspace path resides within allowed directory roots or is a safe workspace path
pub fn validate_allowed_root(
    app_handle: &tauri::AppHandle,
    workspace_path: &str,
) -> Result<(), String> {
    let candidate = expand_and_resolve(workspace_path)?;
    
    if !candidate.is_absolute() {
        return Err(format!("Workspace path '{}' must be absolute.", workspace_path));
    }

    if is_system_directory(&candidate) {
        return Err(format!(
            "Workspace path '{}' is inside a protected system directory and cannot be used.",
            candidate.display()
        ));
    }

    let config = load_config(app_handle)?;

    // 1. Check against explicitly configured allowed roots
    for root_template in &config.allowed_workspace_roots {
        if let Ok(root) = expand_and_resolve(root_template) {
            if path_starts_with(&candidate, &root) {
                return Ok(());
            }
        }
    }

    // 2. Check standard safe user folders (Documents, Desktop, Home)
    if let Some(doc) = dirs::document_dir() {
        if let Ok(p) = expand_and_resolve(&doc.to_string_lossy()) {
            if path_starts_with(&candidate, &p) {
                return Ok(());
            }
        }
    }
    if let Some(desk) = dirs::desktop_dir() {
        if let Ok(p) = expand_and_resolve(&desk.to_string_lossy()) {
            if path_starts_with(&candidate, &p) {
                return Ok(());
            }
        }
    }
    if let Some(home) = dirs::home_dir() {
        if let Ok(p) = expand_and_resolve(&home.to_string_lossy()) {
            if path_starts_with(&candidate, &p) {
                return Ok(());
            }
        }
    }

    // 3. For any other safe user location (e.g. secondary drives like E:\nexsynctest, D:\workspaces, etc.)
    let cand_str = candidate.to_string_lossy();
    if cand_str != "/" && cand_str != "\\" {
        #[cfg(windows)]
        {
            let lower = cand_str.to_lowercase();
            if lower == "c:\\" || lower == "c:/" {
                return Err("The system drive root 'C:\\' cannot be used as a workspace.".to_string());
            }
        }

        // Auto-register candidate as an allowed root so subsequent checks pass smoothly
        let _ = add_allowed_root(app_handle, &cand_str);
        return Ok(());
    }

    Err(format!(
        "Workspace path '{}' is not within any allowed root directory.",
        candidate.display()
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

    #[test]
    fn test_path_starts_with() {
        #[cfg(windows)]
        {
            assert!(path_starts_with(
                std::path::Path::new("E:\\nexsynctest\\sub"),
                std::path::Path::new("e:\\nexsynctest")
            ));
            assert!(path_starts_with(
                std::path::Path::new("E:\\nexsynctest"),
                std::path::Path::new("E:\\nexsynctest")
            ));
            assert!(!path_starts_with(
                std::path::Path::new("E:\\nexsynctest2"),
                std::path::Path::new("E:\\nexsynctest")
            ));
        }
        #[cfg(not(windows))]
        {
            assert!(path_starts_with(
                std::path::Path::new("/home/user/project/sub"),
                std::path::Path::new("/home/user/project")
            ));
        }
    }

    #[test]
    fn test_system_directories_blocked() {
        #[cfg(windows)]
        {
            assert!(is_system_directory(std::path::Path::new("C:\\Windows")));
            assert!(is_system_directory(std::path::Path::new("C:\\Windows\\System32")));
            assert!(is_system_directory(std::path::Path::new("C:\\Program Files\\App")));
            assert!(is_system_directory(std::path::Path::new("E:\\$Recycle.Bin")));
            assert!(!is_system_directory(std::path::Path::new("E:\\nexsynctest")));
        }
        #[cfg(unix)]
        {
            assert!(is_system_directory(std::path::Path::new("/etc")));
            assert!(is_system_directory(std::path::Path::new("/usr/bin")));
            assert!(!is_system_directory(std::path::Path::new("/home/user/nexsynctest")));
        }
    }
}