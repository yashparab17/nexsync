use serde::{Deserialize, Serialize};

/// Top-level workspace identity. The `path` field is the absolute directory
/// on disk where the workspace lives — it is essential for every subsequent
/// read/write operation the frontend performs.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub created_at: String,
    pub updated_at: String,
}

/// All metadata that lives in the workspace SQLite database.
/// This struct is the single payload the frontend receives on workspace
/// load and sends back on save.
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

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Settings {
    pub theme: String,
    pub autosave: bool,
    pub sync: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Member {
    pub id: String,
    pub name: String,
    pub role: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Members {
    pub members: Vec<Member>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Activity {
    pub events: Vec<ActivityEvent>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ActivityEvent {
    pub id: String,
    pub timestamp: String,
    pub action: String,
    pub detail: String,
    /// Optional workspace-relative path for deep-linking (e.g. `/files/notes/a.md`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// Optional entity type for the target (e.g. `file`, `task`, `note`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_type: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Permissions {
    pub owner: Vec<String>,
    pub editor: Vec<String>,
    pub viewer: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct History {
    pub last_opened: String,
    pub recent_files: Vec<String>,
}

// ────────────────────────────
// Task & Kanban types (feature-scoped structured data)
// ────────────────────────────

/// A single task in the Tasks feature.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: String, // "todo" | "in_progress" | "done"
    pub priority: String, // "low" | "medium" | "high"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A single column on the Kanban board.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct KanbanColumn {
    pub id: String,
    pub title: String,
    pub position: i64,
    pub cards: Vec<KanbanCard>,
}

/// A single card inside a Kanban column.
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
// Dashboard / filesystem structs
// ────────────────────────────

/// A single entry (file or folder) inside a workspace subdirectory.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkspaceFile {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: String,
}

/// Aggregate statistics for the Dashboard stat cards.
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

/// A single entry in the app-level error log (`errors.jsonl`).
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

#[derive(Deserialize)]
pub struct CreateWorkspaceRequest {
    pub name: String,
    pub description: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UpdateMetadataRequest {
    pub path: String,
    pub metadata: WorkspaceMetadata,
}

#[derive(Deserialize)]
pub struct TaskRequest {
    pub path: String,
    pub task: Task,
}

#[derive(Deserialize)]
pub struct TaskIdRequest {
    pub path: String,
    pub id: String,
}

#[derive(Deserialize)]
pub struct KanbanColumnRequest {
    pub path: String,
    pub column: KanbanColumn,
}

#[derive(Deserialize)]
pub struct KanbanCardRequest {
    pub path: String,
    pub card: KanbanCard,
}

#[derive(Deserialize)]
pub struct MoveCardRequest {
    pub path: String,
    pub card_id: String,
    pub column_id: String,
    pub position: i64,
}