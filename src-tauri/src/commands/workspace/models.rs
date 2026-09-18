//! Data transfer models and metadata structures for workspaces.

use serde::{Deserialize, Serialize};

/// Top-level workspace identity model
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Full workspace metadata payload
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct WorkspaceMetadata {
    pub workspace: WorkspaceInfo,
    pub settings: Settings,
    pub members: Members,
    pub activity: Activity,
    pub permissions: Permissions,
    pub history: History,
}

// ────────────────────────────
// Individual metadata structs
// ────────────────────────────

/// Workspace settings
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Settings {
    pub theme: String,
    pub autosave: bool,
    pub sync: bool,
}

/// Workspace collaborator
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Member {
    pub id: String,
    pub name: String,
    pub role: String,
}

/// List of workspace collaborators
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Members {
    pub members: Vec<Member>,
}

/// Workspace activity events list
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Activity {
    pub events: Vec<ActivityEvent>,
}

/// Single activity log event
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ActivityEvent {
    pub id: String,
    pub timestamp: String,
    pub action: String,
    pub detail: String,
    /// Optional workspace-relative path for deep-linking
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// Optional entity type for target
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_type: Option<String>,
}

/// Role-based permission lists
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Permissions {
    pub owner: Vec<String>,
    pub editor: Vec<String>,
    pub viewer: Vec<String>,
}

/// Workspace access history
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct History {
    pub last_opened: String,
    pub recent_files: Vec<String>,
}

// ────────────────────────────
// Task & Kanban types
// ────────────────────────────

/// A single task model
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A Kanban column model
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct KanbanColumn {
    pub id: String,
    pub title: String,
    pub position: i64,
    pub cards: Vec<KanbanCard>,
}

/// A single Kanban card model
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct KanbanCard {
    pub id: String,
    pub title: String,
    pub description: String,
    pub column_id: String,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

// ────────────────────────────
// Dashboard & Filesystem structs
// ────────────────────────────

/// A single workspace directory entry
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkspaceFile {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: String,
}

/// Aggregated metrics for workspace dashboard
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct WorkspaceStats {
    pub files: usize,
    pub assets: usize,
    pub tasks: usize,
    pub kanban_cards: usize,
    pub members: usize,
}

// ────────────────────────────
// Error logging
// ────────────────────────────

/// A single error record entry
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ErrorRecord {
    pub timestamp: String,
    pub message: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

// ────────────────────────────
// Request structs
// ────────────────────────────

/// Workspace creation payload
#[derive(Deserialize)]
pub struct CreateWorkspaceRequest {
    pub name: String,
    pub description: String,
    pub path: String,
}

/// Metadata update payload
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UpdateMetadataRequest {
    pub path: String,
    pub metadata: WorkspaceMetadata,
}

/// Task creation or update payload
#[derive(Deserialize)]
pub struct TaskRequest {
    pub path: String,
    pub task: Task,
}

/// Payload identifying item by ID
#[derive(Deserialize)]
pub struct TaskIdRequest {
    pub path: String,
    pub id: String,
}

/// Kanban column payload
#[derive(Deserialize)]
pub struct KanbanColumnRequest {
    pub path: String,
    pub column: KanbanColumn,
}

/// Kanban card payload
#[derive(Deserialize)]
pub struct KanbanCardRequest {
    pub path: String,
    pub card: KanbanCard,
}

/// Card position move payload
#[derive(Deserialize)]
pub struct MoveCardRequest {
    pub path: String,
    pub card_id: String,
    pub column_id: String,
    pub position: i64,
}