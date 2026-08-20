// ────────────────────────────
// Core types
// ────────────────────────────

export interface WorkspaceInfo {
	id: string;
	name: string;
	description: string;
	path: string;
	created_at: string;
	updated_at: string;
}

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

export interface Settings {
	theme: string;
	autosave: boolean;
	sync: boolean;
}

export interface Member {
	id: string;
	name: string;
	role: string;
}

export interface Members {
	members: Member[];
}

export interface ActivityEvent {
	id: string;
	timestamp: string;
	action: string;
	detail: string;
	/** Optional workspace-relative path for deep-linking (e.g. `/files/notes/a.md`). */
	target?: string;
	/** Optional entity type for the target (e.g. `file`, `task`, `note`). */
	target_type?: string;
}

export interface Activity {
	events: ActivityEvent[];
}

export interface Permissions {
	owner: string[];
	editor: string[];
	viewer: string[];
}

export interface History {
	last_opened: string;
	recent_files: string[];
}

// ────────────────────────────
// Filesystem / dashboard types
// ────────────────────────────

/** A single file or folder entry inside a workspace content subdirectory. */
export interface WorkspaceFile {
	name: string;
	/** Workspace-relative path, e.g. `/files/notes/a.md`. */
	path: string;
	is_dir: boolean;
	size: number;
	modified_at: string;
}

/** Aggregate statistics shown on the workspace Dashboard. */
export interface WorkspaceStats {
	files: number;
	assets: number;
	tasks: number;
	kanban_cards: number;
	members: number;
}

// ────────────────────────────
// Error log
// ────────────────────────────

/** A single entry appended to the app-level error log (`errors.jsonl`). */
export interface ErrorRecord {
	timestamp: string;
	/** Short, human-readable summary of what failed. */
	message: string;
	/** Categorizes where the error originated (e.g. `workspace_load`). */
	source: string;
	/** Workspace path if the error is tied to one (optional for future use). */
	workspace?: string;
	/** Optional structured detail (e.g. a stack trace). */
	detail?: string;
}

// ────────────────────────────
// Request types
// ────────────────────────────

export interface CreateWorkspaceRequest {
	name: string;
	description: string;
	path: string;
}

export interface UpdateMetadataRequest {
	path: string;
	metadata: WorkspaceMetadata;
}

// ────────────────────────────
// Task & Kanban types
// ────────────────────────────

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";

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

export interface KanbanColumn {
	id: string;
	title: string;
	position: number;
	cards: KanbanCard[];
}

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
// Task / Kanban request types
// ────────────────────────────

export interface TaskRequest {
	path: string;
	task: Task;
}

export interface TaskIdRequest {
	path: string;
	id: string;
}

export interface KanbanColumnRequest {
	path: string;
	column: KanbanColumn;
}

export interface KanbanCardRequest {
	path: string;
	card: KanbanCard;
}

export interface MoveCardRequest {
	path: string;
	card_id: string;
	column_id: string;
	position: number;
}
