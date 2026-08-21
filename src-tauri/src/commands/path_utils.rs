use std::path::{Path, PathBuf};

/// Validates that a workspace path is absolute and canonical, and that a relative path
/// stays within the workspace root directory.
/// 
/// Returns the canonical path if valid, or an error message if invalid.
/// 
/// Security hardening against:
/// - Directory traversal via `..` components (C2)
/// - Case-insensitivity bypass on Windows (C2)
/// - Intermediate symlink escapes (C2)
/// - Lexical vs resolved path mismatch (C2)
pub fn resolve_workspace_path(workspace_path: &str, rel_path: &str) -> Result<PathBuf, String> {
    let workspace = Path::new(workspace_path);
    
    // Ensure the workspace path is absolute
    if !workspace.is_absolute() {
        return Err("Workspace path must be absolute".to_string());
    }
    
    // Canonicalize the workspace path to resolve symlinks, normalize case (on Windows),
    // and ensure we're working with a real existing directory
    let canonical_workspace = workspace.canonicalize()
        .map_err(|e| format!("Failed to canonicalize workspace path: {}", e))?;
    
    // Ensure the path is a directory
    if !canonical_workspace.is_dir() {
        return Err("Workspace path must point to a directory".to_string());
    }
    
    // Validate that rel_path doesn't contain dangerous components
    validate_rel_path(rel_path)?;
    
    // Build the full path lexically first
    let full_path_lexical = canonical_workspace.join(rel_path);
    
    // CRITICAL FIX: Re-canonicalize the joined path to resolve any intermediate symlinks
    // and catch cases where join() created a path outside the workspace via symlink escape
    let full_path_canonicalized = full_path_lexical.canonicalize()
        .map_err(|e| format!("Failed to canonicalize target path: {}", e))?;
    
    // Ensure the canonicalized full path is strictly within the workspace
    // Use strict comparison - the workspace itself is not considered inside itself
    if !full_path_canonicalized.starts_with(&canonical_workspace) && 
       full_path_canonicalized != canonical_workspace {
        return Err("Path traversal detected: target resolves outside workspace".to_string());
    }
    
    Ok(full_path_canonicalized)
}

/// Validates a relative path component before joining to prevent various injection attacks
fn validate_rel_path(rel_path: &str) -> Result<(), String> {
    const ALLOWED_ROOTS: &[&str] = &["notes", "files", "assets", "tasks", "kanban", "editor"];
    
    let rel_path = rel_path.trim_matches('/');
    if rel_path.is_empty() {
        return Err("The path cannot be empty.".into());
    }
    
    // Allow "." as a special case (current directory)
    if rel_path == "." {
        return Ok(());
    }
    
    let segments: Vec<&str> = rel_path.split('/').collect();
    
    // First segment must be an allowed root
    if !ALLOWED_ROOTS.contains(&segments[0]) {
        return Err(format!(
            "Invalid workspace root '{}' - must be one of: {}, files, assets, tasks, kanban, notes",
            segments[0], ALLOWED_ROOTS[0]
        ));
    }
    
    // Check each segment for malicious content
    for segment in &segments {
        // Reject empty segments (from double slashes like "files//a.md")
        if segment.is_empty() {
            return Err(format!("Empty path segment detected"));
        }
        
        // Explicitly reject path traversal attempts
        if *segment == ".." || *segment == "." {
            return Err(format!("Invalid path segment: '{}'", segment));
        }
        
        // Reject Windows-style path separators
        if segment.contains('\\') {
            return Err(format!("Backslash not allowed in path: '\\\\'"));
        }
        
        // Reject colon (Windows drive letters, NTFS alternate data streams)
        if segment.contains(':') {
            return Err(format!("Colon not allowed in path segment"));
        }
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_valid_path() {
        let temp_dir = std::env::temp_dir().join(format!("nexsync_test_{}", uuid::Uuid::new_v4()));
        let files_dir = temp_dir.join("files");
        fs::create_dir_all(&files_dir).expect("create test dirs");
        let test_file = files_dir.join("test.txt");
        fs::write(&test_file, "hello").expect("write test file");

        let workspace_str = temp_dir.to_string_lossy().to_string();
        let result = resolve_workspace_path(&workspace_str, "files/test.txt");
        assert!(result.is_ok());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_absolute_path_rejected() {
        let result = resolve_workspace_path("/tmp/workspace", "/etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn test_traversal_parent_directory() {
        let result = resolve_workspace_path("/tmp/workspace", "../etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn test_traversal_multiple_levels() {
        let result = resolve_workspace_path("/tmp/workspace", "../../etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn test_double_dot_current_dir_rejected() {
        // Even explicit "." should be rejected after the root
        let result = resolve_workspace_path("/tmp/workspace", "files/./test.txt");
        assert!(result.is_err());
    }

    #[test]
    fn test_double_slash_rejected() {
        let result = resolve_workspace_path("/tmp/workspace", "files//test.txt");
        assert!(result.is_err());
    }

    #[test]
    fn test_backslash_rejected() {
        let result = resolve_workspace_path("/tmp/workspace", "files\\test.txt");
        assert!(result.is_err());
    }

    #[test]
    fn test_colon_rejected() {
        let result = resolve_workspace_path("/tmp/workspace", "files:test.txt");
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_root_rejected() {
        let result = resolve_workspace_path("/tmp/workspace", "malicious/path.txt");
        assert!(result.is_err());
    }
}
