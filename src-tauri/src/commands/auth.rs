//! Workspace authorization and in-memory session management.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

/// Global workspace session registry (thread-safe)
pub type SessionRegistry = Arc<Mutex<HashMap<String, WorkspaceSession>>>;

/// A workspace session represents an opened workspace with its permissions
#[derive(Debug, Clone)]
pub struct WorkspaceSession {
    /// Unique session ID (UUID token for IPC calls)
    pub session_id: String,
    /// Absolute path to the workspace root
    pub workspace_path: String,
    /// Current user's role within this workspace
    pub user_role: UserRole,
    /// When the session was created
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// User roles for role-based access control
#[derive(Debug, Clone, PartialEq, Eq, strum::Display, Default)]
#[strum(serialize_all = "snake_case")]
pub enum UserRole {
    Owner,
    Editor,
    #[default]
    Viewer,
}

/// Create a new workspace session with a unique token
pub fn create_session(workspace_path: &str, user_role: UserRole) -> String {
    let session_id = Uuid::new_v4().to_string();
    let session = WorkspaceSession {
        session_id: session_id.clone(),
        workspace_path: workspace_path.to_string(),
        user_role,
        created_at: chrono::Utc::now(),
    };
    
    SESSION_REGISTRY.lock()
        .expect("Failed to acquire lock on session registry")
        .insert(session_id.clone(), session);
    
    session_id
}

/// Get a workspace session by its token
pub fn get_session(session_id: &str) -> Option<WorkspaceSession> {
    SESSION_REGISTRY.lock()
        .expect("Failed to acquire lock on session registry")
        .get(session_id)
        .cloned()
}

/// Remove a session when closing a workspace
pub fn remove_session(session_id: &str) -> bool {
    SESSION_REGISTRY.lock()
        .expect("Failed to acquire lock on session registry")
        .remove(session_id)
        .is_some()
}

/// Initialize the session registry
pub fn init() {
    if SESSION_REGISTRY.lock().is_err() {
        eprintln!("Warning: Session registry already initialized");
    }
}

// Global thread-safe session map
pub static SESSION_REGISTRY: std::sync::LazyLock<SessionRegistry> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

// ─────────────────────────────────────────────────────────────────────────────
// Tauri Commands for Session Management
// ─────────────────────────────────────────────────────────────────────────────

/// Creates a new workspace session token
#[tauri::command]
pub fn create_workspace_session(workspace_path: String) -> Result<String, String> {
    let session_id = create_session(&workspace_path, UserRole::Owner);
    Ok(session_id)
}

/// Closes an active workspace session token
#[tauri::command]
pub fn close_workspace_session(session_id: String) -> Result<(), String> {
    if !remove_session(&session_id) {
        return Err(format!("Session '{}' not found", session_id));
    }
    Ok(())
}

/// Retrieves active session details for frontend authorization
#[tauri::command]
pub fn get_current_session_info(_app_handle: tauri::AppHandle, session_id: String) -> Result<Option<SessionInfo>, String> {
    let session = get_session(&session_id)
        .ok_or_else(|| "Invalid or expired session token".to_string())?;
    
    Ok(Some(SessionInfo {
        session_id: session.session_id.clone(),
        workspace_path: session.workspace_path,
        user_role: session.user_role.to_string(),
        created_at: session.created_at.to_rfc3339(),
    }))
}

/// Session info returned to frontend
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct SessionInfo {
    pub session_id: String,
    pub workspace_path: String,
    pub user_role: String,
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_get_session() {
        init();
        let session_id = create_session("/tmp/test-workspace", UserRole::Editor);
        
        let session = get_session(&session_id);
        assert!(session.is_some());
        
        let s = session.unwrap();
        assert_eq!(s.workspace_path, "/tmp/test-workspace");
        assert_eq!(s.user_role, UserRole::Editor);
    }

    #[test]
    fn test_remove_session() {
        init();
        let session_id = create_session("/tmp/test-workspace", UserRole::Viewer);
        
        let removed = remove_session(&session_id);
        assert!(removed);
        
        let session = get_session(&session_id);
        assert!(session.is_none());
    }

}