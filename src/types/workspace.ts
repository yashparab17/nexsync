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
