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
	deviceId?: string; // P2P device key; roles are enforced against this, not the name
	lastSeen?: number; // When the host last saw this member's connection end, in ms; only the host sets it
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
	// Who did it; older events have none
	author?: string;
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

// Result of moving a workspace to the recycle bin
export interface DeleteOutcome {
	wholeFolder: boolean; // False if other files in the folder were left in place
	kept: string[]; // Names of the files that were left behind
}

// Deleted item in .nexsync/trash
export interface TrashItem {
	id: string;
	relPath: string;
	isDir: boolean;
	size: number;
	deletedAt: number;
}

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
	tags: string[];
	comments?: Comment[];
	conflicts?: Conflict[];
	violations?: Violation[];
	crdt?: unknown; // Merge state exchanged between devices; the app never reads it
	created_at: string;
	updated_at: string;
}

// A field where two people wrote different values while apart; the first option is the one being shown
export interface ConflictOption {
	value: unknown;
	ts: number;
	who?: string;
	by?: string; // The device key that signed this value, when it was signed
}
export interface Conflict {
	field: string;
	options: ConflictOption[];
}

// A private copy of one task or card to change without touching the real one, then review and merge
export interface Draft {
	id: string;
	entity: "task" | "card";
	target: string;
	name: string;
	author: string | null;
	created_at: number;
	status: "open" | "merged";
}

// One field that merging a draft would change in the real record
export interface DraftChange {
	path: string;
	live: unknown;
	draft: unknown;
}

// What merging a draft would do, worked out before anything is changed
export interface DraftPreview {
	changes: DraftChange[];
	// Fields the draft and somebody else both changed since it was started; the person chooses one after merging
	collisions: Conflict[];
	// The real record was deleted, so there is nothing to merge into
	deleted: boolean;
}

// A private try-out of a reorganised board: cards moved in it stay where they are on the real board until it is merged
export interface BoardDraft {
	id: string;
	name: string;
	author: string | null;
	created_at: number;
	status: "open" | "merged";
}

// What merging a board draft would change in one card
export interface CardReview {
	id: string;
	title: string;
	changes: DraftChange[];
	collisions: Conflict[];
	// The card was deleted meanwhile, so its part of the draft is dropped
	deleted: boolean;
}

export interface BoardPreview {
	cards: CardReview[];
}

// A rule about the whole record that it breaks right now; unlike a conflict, there is no value to choose between
export interface Violation {
	rule: string;
	message: string;
}

// A rule a workspace can turn on
export interface RuleInfo {
	id: string;
	text: string;
	applies_to: string;
	enabled: boolean;
}

// One change somebody else made, as kept for the catch-up review. `before` and `after` are JSON for a field and plain
// text for a file; either is null when there was no value, or the text was too large to keep.
export interface CatchupEntry {
	id: number;
	at: number;
	kind: "field" | "created" | "deleted" | "text";
	entity: "task" | "card" | "file";
	target: string;
	label: string;
	path: string;
	before: string | null;
	after: string | null;
	who: string | null; // A name the writing device chose
	signer: string | null; // The device key that signed the change, when it was signed
	state: "new" | "reverted";
}

// A comment on a task or card; "@Name" in the text mentions a collaborator
export interface Comment {
	id: string;
	author: string;
	text: string;
	at: string;
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
	tags: string[];
	due_date?: string; // A calendar day, YYYY-MM-DD
	assignee_id?: string;
	checklist: ChecklistItem[];
	comments?: Comment[];
	conflicts?: Conflict[];
	violations?: Violation[];
	crdt?: unknown;
	created_at: string;
	updated_at: string;
}

// One line of a card's checklist
export interface ChecklistItem {
	id: string;
	text: string;
	done: boolean;
}

// ────────────────────────────
// Task & Kanban requests
// ────────────────────────────

// Request to create or update a task
export interface TaskRequest {
	path: string;
	task: Task;
	// The copy the person started editing from, so a collaborator's newer change to a field they did not touch is kept
	base?: Task;
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
	base?: KanbanCard;
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
	// Name shown to collaborators; empty means "Collaborator"
	display_name: string;
	// HTTP proxy for reaching other networks, such as http://host:port; empty means none
	proxy_url: string;
}


// ────────────────────────────
// Version history
// ────────────────────────────

// One saved state of a file; history is kept per device
export interface FileVersion {
	id: number;
	path: string;
	hash: string;
	size: number;
	// save, sync, import, auto (periodic snapshot), named, restore or before-restore
	source: string;
	label: string | null;
	// Who named it, for versions a collaborator named
	author: string | null;
	createdAt: string;
}
