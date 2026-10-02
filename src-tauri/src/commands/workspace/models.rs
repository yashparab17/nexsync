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
    /// The collaborator's P2P device key, which is what roles are enforced against
    #[serde(default, rename = "deviceId", skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
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
    /// Who did it, when known
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
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
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
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
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub comments: Vec<Comment>,
    /// What other devices need to merge this record field by field; sent between devices, not shown
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crdt: Option<super::crdt::RecordState>,
    /// Fields where two people wrote different values at the same time and nobody has chosen yet
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conflicts: Vec<super::crdt::Conflict>,
    /// Rules about the whole record that it breaks right now, when the workspace has turned them on
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub violations: Vec<super::invariants::Violation>,
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
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct KanbanCard {
    pub id: String,
    pub title: String,
    pub description: String,
    pub column_id: String,
    /// Where the card sits in its column. A drop puts it halfway between its neighbours, so this is not always whole
    pub position: f64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignee_id: Option<String>,
    #[serde(default)]
    pub checklist: Vec<ChecklistItem>,
    #[serde(default)]
    pub comments: Vec<Comment>,
    /// What other devices need to merge this record field by field; sent between devices, not shown
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crdt: Option<super::crdt::RecordState>,
    /// Fields where two people wrote different values at the same time and nobody has chosen yet
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conflicts: Vec<super::crdt::Conflict>,
    /// Rules about the whole record that it breaks right now, when the workspace has turned them on
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub violations: Vec<super::invariants::Violation>,
    pub created_at: String,
    pub updated_at: String,
}

/// One line of a card's checklist
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ChecklistItem {
    pub id: String,
    pub text: String,
    pub done: bool,
}

/// A comment on a task or card. `@Name` in the text mentions a collaborator.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Comment {
    pub id: String,
    pub author: String,
    pub text: String,
    pub at: String,
}

const MAX_COMMENTS: usize = 200;
const MAX_TAGS: usize = 10;
const MAX_TAG_LEN: usize = 32;
const MAX_CHECKLIST_ITEMS: usize = 50;

/// Tags and checklists live in one JSON text column each; unreadable text reads as empty
pub fn json_list<T: serde::de::DeserializeOwned>(text: &str) -> Vec<T> {
    serde_json::from_str(text).unwrap_or_default()
}

pub fn to_json<T: Serialize>(items: &[T]) -> String {
    serde_json::to_string(items).unwrap_or_else(|_| "[]".to_string())
}

/// At most 10 tags of 1 to 32 characters
pub fn valid_tags(tags: &[String]) -> bool {
    tags.len() <= MAX_TAGS && tags.iter().all(|t| !t.trim().is_empty() && t.chars().count() <= MAX_TAG_LEN)
}

/// At most 50 items of up to 256 characters
pub fn valid_checklist(items: &[ChecklistItem]) -> bool {
    items.len() <= MAX_CHECKLIST_ITEMS && items.iter().all(|i| i.id.len() <= 64 && i.text.len() <= 256)
}

/// At most 200 comments, each of 1 to 2000 characters
pub fn valid_comments(items: &[Comment]) -> bool {
    items.len() <= MAX_COMMENTS
        && items.iter().all(|c| {
            !c.text.trim().is_empty() && c.text.len() <= 2000 && c.id.len() <= 64 && c.author.len() <= 64 && c.at.len() <= 64
        })
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
    /// The copy the person started editing from, so a newer change by someone else to a field they did not touch is kept
    #[serde(default)]
    pub base: Option<Task>,
    /// Who is making the change, shown beside the value if it ever conflicts with another
    #[serde(default)]
    pub author: Option<String>,
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
    #[serde(default)]
    pub base: Option<KanbanCard>,
    #[serde(default)]
    pub author: Option<String>,
}

/// Card position move payload
#[derive(Deserialize)]
pub struct MoveCardRequest {
    pub path: String,
    pub card_id: String,
    pub column_id: String,
    pub position: f64,
    #[serde(default)]
    pub author: Option<String>,
}