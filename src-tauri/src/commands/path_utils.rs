//! Path canonicalization and directory traversal prevention utilities.

use std::path::{Path, PathBuf};

/// Validates that a workspace path is absolute and canonical, and that relative path remains bounded
pub fn resolve_workspace_path(workspace_path: &str, rel_path: &str) -> Result<PathBuf, String> {
    let workspace = Path::new(workspace_path);
    
    // Ensure workspace path is absolute
    if !workspace.is_absolute() {
        return Err("Workspace path must be absolute".to_string());
    }
    
    // Canonicalize workspace root
    let canonical_workspace = workspace.canonicalize()
        .map_err(|e| format!("Failed to canonicalize workspace path: {}", e))?;
    
    if !canonical_workspace.is_dir() {
        return Err("Workspace path must point to a directory".to_string());
    }
    
    // Validate relative path segments
    validate_rel_path(rel_path)?;
    
    let full_path_lexical = canonical_workspace.join(rel_path);
    
    // Verify existing path containment
    if let Ok(full_path_canonicalized) = full_path_lexical.canonicalize() {
        if !full_path_canonicalized.starts_with(&canonical_workspace) && 
           full_path_canonicalized != canonical_workspace {
            return Err("Path traversal detected: target resolves outside workspace".to_string());
        }
        return Ok(full_path_canonicalized);
    }

    // For non-existent files, verify ancestor directory containment
    let mut ancestor = full_path_lexical.as_path();
    let mut trailing_components = Vec::new();

    while !ancestor.exists() {
        if let Some(file_name) = ancestor.file_name() {
            trailing_components.push(file_name);
        }
        match ancestor.parent() {
            Some(p) => ancestor = p,
            None => return Err("Invalid path structure for target file".to_string()),
        }
    }

    let canonical_ancestor = ancestor.canonicalize()
        .map_err(|e| format!("Failed to canonicalize ancestor directory: {}", e))?;

    if !canonical_ancestor.starts_with(&canonical_workspace) && canonical_ancestor != canonical_workspace {
        return Err("Path traversal detected: ancestor directory resolves outside workspace".to_string());
    }

    // Reconstruct normalized path
    let mut resolved = canonical_ancestor;
    for component in trailing_components.into_iter().rev() {
        resolved = resolved.join(component);
    }

    Ok(resolved)
}

/// Validates relative path segments to reject traversal patterns and invalid separators
fn validate_rel_path(rel_path: &str) -> Result<(), String> {
    const ALLOWED_ROOTS: &[&str] = &["notes", "files", "assets", "tasks", "kanban", "editor"];
    
    let rel_path = rel_path.trim_matches('/');
    if rel_path.is_empty() || rel_path == "." {
        return Ok(());
    }
    
    let mut segments = rel_path.split('/');
    
    // Ensure first segment is an allowed feature root
    let first = segments.next().unwrap_or("");
    if !ALLOWED_ROOTS.contains(&first) {
        return Err(format!(
            "Invalid workspace root '{first}' - must be one of: {}, files, assets, tasks, kanban, notes",
            ALLOWED_ROOTS[0]
        ));
    }
    
    if first.contains('\\') || first.contains(':') {
        return Err("Illegal characters in path segment".to_string());
    }
    
    // Check remaining segments
    for segment in segments {
        if segment.is_empty() || segment == ".." || segment == "." || segment.contains('\\') || segment.contains(':') {
            return Err(format!("Invalid path segment: '{segment}'"));
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

    #[test]
    fn test_non_existent_file_path() {
        let temp_dir = std::env::temp_dir().join(format!("nexsync_test_{}", uuid::Uuid::new_v4()));
        let files_dir = temp_dir.join("files");
        fs::create_dir_all(&files_dir).expect("create test dirs");

        let workspace_str = temp_dir.to_string_lossy().to_string();
        let result = resolve_workspace_path(&workspace_str, "files/new_uncreated_file.txt");
        assert!(result.is_ok());

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
