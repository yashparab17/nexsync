// ────────────────────────────
// Core workspace types
// ────────────────────────────

// Top-level workspace identity
export interface WorkspaceInfo {
	id: string;
	name: string;
	description: string;
	path: string;
	created_at: string;
	updated_at: string;
}

// Complete workspace metadata state
export interface WorkspaceMetadata {
	workspace: WorkspaceInfo;
	settings: Settings;
	members: Members;
	activity: Activity;
	permissions: Permissions;
	history: History;
}

// ────────────────────────────
// Individual metadata types
// ────────────────────────────

// User preferences for workspace
export interface Settings {
	theme: string;
	autosave: boolean;
	sync: boolean;
}

// Workspace collaborator
export interface Member {
	id: string;
	name: string;
	role: string;
}

// List of workspace collaborators
export interface Members {
	members: Member[];
}

// Workspace audit trail event
export interface ActivityEvent {
	id: string;
	timestamp: string;
	action: string;
	detail: string;
	// Optional workspace-relative path for deep-linking
	target?: string;
	// Optional entity type for target (e.g. file, task, note)
	target_type?: string;
}

// Workspace activity history
export interface Activity {
	events: ActivityEvent[];
}

// Role-based permissions map
export interface Permissions {
	owner: string[];
	editor: string[];
	viewer: string[];
}

// Workspace access history
export interface History {
	last_opened: string;
	recent_files: string[];
}

// ────────────────────────────
// Filesystem & Dashboard types
// ────────────────────────────

// File or folder entry in workspace directory
export interface WorkspaceFile {
	name: string;
	// Workspace-relative path (e.g. /files/notes/a.md)
	path: string;
	is_dir: boolean;
	size: number;
	modified_at: string;
}

// Summary metrics displayed on workspace dashboard
export interface WorkspaceStats {
	files: number;
	assets: number;
	tasks: number;
	kanban_cards: number;
	members: number;
}

// ────────────────────────────
// Asset types & categories
// ────────────────────────────

export type AssetCategory = "all" | "image" | "video" | "audio" | "document" | "other";

export type AssetSyncStatus = "synced" | "remote_placeholder" | "downloading";

export interface AssetItem extends WorkspaceFile {
	category: AssetCategory;
	mimeType?: string;
	syncStatus: AssetSyncStatus;
	dimensions?: { width: number; height: number };
}

// ────────────────────────────
// Error logging types
// ────────────────────────────

// App-level error record stored in errors.jsonl
export interface ErrorRecord {
	timestamp: string;
	message: string;
	source: string;
	workspace?: string;
	detail?: string;
}

// ────────────────────────────
// Request payload types
// ────────────────────────────

// Payload for creating a new workspace
export interface CreateWorkspaceRequest {
	name: string;
	description: string;
	path: string;
}

// Payload for updating workspace metadata
export interface UpdateMetadataRequest {
	path: string;
	metadata: WorkspaceMetadata;
}

// ────────────────────────────
// Task & Kanban types
// ────────────────────────────

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";

// Task item model
export interface Task {
	id: string;
	title: string;
	description: string;
	status: TaskStatus;
	priority: TaskPriority;
	due_date?: string;
	assignee_id?: string;
	created_at: string;
	updated_at: string;
}

// Kanban column containing ordered cards
export interface KanbanColumn {
	id: string;
	title: string;
	position: number;
	cards: KanbanCard[];
}

// Kanban card item
export interface KanbanCard {
	id: string;
	title: string;
	description: string;
	column_id: string;
	position: number;
	created_at: string;
	updated_at: string;
}

// ────────────────────────────
// Task & Kanban requests
// ────────────────────────────

// Request to create or update a task
export interface TaskRequest {
	path: string;
	task: Task;
}

// Request referencing a task or item by ID
export interface TaskIdRequest {
	path: string;
	id: string;
}

// Request to create a kanban column
export interface KanbanColumnRequest {
	path: string;
	column: KanbanColumn;
}

// Request to create or update a kanban card
export interface KanbanCardRequest {
	path: string;
	card: KanbanCard;
}

// Request to move a card to a different column or index
export interface MoveCardRequest {
	path: string;
	card_id: string;
	column_id: string;
	position: number;
}

// ────────────────────────────
// App Security & Configuration
// ────────────────────────────

export interface NexsyncConfig {
	allowed_workspace_roots: string[];
}
