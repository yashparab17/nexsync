use std::path::{Path, PathBuf};

/// Validates that a workspace path is absolute and canonical, and that a relative path
/// stays within the workspace root directory.
/// 
/// Returns the canonical path if valid, or an error message if invalid.
pub fn resolve_workspace_path(workspace_path: &str, rel_path: &str) -> Result<PathBuf, String> {
    let workspace = Path::new(workspace_path);
    
    // Ensure the workspace path is absolute
    if !workspace.is_absolute() {
        return Err("Workspace path must be absolute".to_string());
    }
    
    // Canonicalize the workspace path to resolve symlinks and normalize
    let canonical_workspace = workspace.canonicalize()
        .map_err(|e| format!("Failed to canonicalize workspace path: {}", e))?;
    
    // Ensure the path is a directory
    if !canonical_workspace.is_dir() {
        return Err("Workspace path must point to a directory".to_string());
    }
    
    // Build the full path
    let full_path = canonical_workspace.join(rel_path);
    
    // Ensure the full path starts with the canonical workspace path
    // This prevents directory traversal attacks
    if !full_path.starts_with(&canonical_workspace) {
        return Err("Path traversal detected".to_string());
    }
    
    // Ensure the path is not a symlink that escapes the workspace
    if full_path.symlink_metadata().map(|meta| meta.is_symlink()).unwrap_or(false) {
        return Err("Symlink detected in path".to_string());
    }
    
    Ok(full_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_path() {
        let result = resolve_workspace_path("/tmp/workspace", "files/test.txt");
        assert!(result.is_ok());
    }

    #[test]
    fn test_absolute_path() {
        let result = resolve_workspace_path("/tmp/workspace", "/etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn test_traversal() {
        let result = resolve_workspace_path("/tmp/workspace", "../etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn test_symlink() {
        let result = resolve_workspace_path("/tmp/workspace", "symlink");
        assert!(result.is_err());
    }
}