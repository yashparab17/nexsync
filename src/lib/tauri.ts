// Typed wrapper around Tauri IPC commands
// All backend invocations go through these functions to keep IPC calls type-safe

import { invoke } from "@tauri-apps/api/core";

import type {
	WorkspaceInfo,
	WorkspaceMetadata,
	WorkspaceFile,
	WorkspaceStats,
	ErrorRecord,
	CreateWorkspaceRequest,
	UpdateMetadataRequest,
	Task,
	KanbanColumn,
	KanbanCard,
	TaskRequest,
	TaskIdRequest,
	KanbanColumnRequest,
	KanbanCardRequest,
	MoveCardRequest,
	NexsyncConfig,
} from "@/types/workspace";

// ────────────────────────────
// Session Token State
// ────────────────────────────

let activeSessionToken: string | null = null;

// Store the active session token in memory
export function setActiveSessionToken(token: string | null) {
	activeSessionToken = token;
}

// Get the current active session token
export function getActiveSessionToken(): string | null {
	return activeSessionToken;
}

// ────────────────────────────
// Session Management Commands
// ────────────────────────────

// Create a new session for the workspace
export function createWorkspaceSession(
	workspacePath: string,
): Promise<string> {
	return invoke("create_workspace_session", { workspacePath });
}

// Close an active workspace session
export function closeWorkspaceSession(sessionId: string): Promise<void> {
	return invoke("close_workspace_session", { sessionId });
}

// Fetch session info including role and created timestamp
export function getCurrentSessionInfo(
	sessionId: string,
): Promise<{ sessionId: string; workspacePath: string; userRole: string; createdAt: string } | null> {
	return invoke("get_current_session_info", { sessionId });
}

// ────────────────────────────
// Error logging
// ────────────────────────────

// Append an error record to app-level error log
export function logError(entry: ErrorRecord): Promise<void> {
	return invoke("log_error", { entry });
}

// ────────────────────────────
// Workspace creation & import
// ────────────────────────────

// Create a new workspace directory and database
export function createWorkspace(
	request: CreateWorkspaceRequest,
): Promise<WorkspaceInfo> {
	return invoke("create_workspace", { request });
}

// Import an existing workspace from disk
export function importWorkspace(path: string): Promise<WorkspaceInfo> {
	return invoke("import_workspace", { path });
}

// ────────────────────────────
// Metadata read & write
// ────────────────────────────

// Load full workspace metadata from database
export function readWorkspaceMetadata(
	path: string,
): Promise<WorkspaceMetadata> {
	return invoke("read_workspace_metadata", { path });
}

// Persist updated workspace metadata to database
export function writeWorkspaceMetadata(
	request: UpdateMetadataRequest,
): Promise<void> {
	return invoke("write_workspace_metadata", { request });
}

// ────────────────────────────
// Task commands
// ────────────────────────────

// Fetch all tasks for a workspace
export function getTasks(path: string): Promise<Task[]> {
	return invoke("get_tasks", { path });
}

// Create a new task in the workspace
export function createTask(request: TaskRequest): Promise<Task> {
	return invoke("create_task", { request });
}

// Update an existing task
export function updateTask(request: TaskRequest): Promise<void> {
	return invoke("update_task", { request });
}

// Delete a task by ID
export function deleteTask(request: TaskIdRequest): Promise<void> {
	return invoke("delete_task", { request });
}

// ────────────────────────────
// Kanban commands
// ────────────────────────────

// Fetch kanban board columns and cards
export function getKanban(path: string): Promise<KanbanColumn[]> {
	return invoke("get_kanban", { path });
}

// Create a new kanban column
export function createKanbanColumn(
	request: KanbanColumnRequest,
): Promise<KanbanColumn> {
	return invoke("create_kanban_column", { request });
}

// Create a new kanban card
export function createKanbanCard(
	request: KanbanCardRequest,
): Promise<KanbanCard> {
	return invoke("create_kanban_card", { request });
}

// Update card title, description, or column
export function updateKanbanCard(request: KanbanCardRequest): Promise<void> {
	return invoke("update_kanban_card", { request });
}

// Move card to a new column and position
export function moveKanbanCard(request: MoveCardRequest): Promise<void> {
	return invoke("move_kanban_card", { request });
}

// Delete a kanban column and its cards
export function deleteKanbanColumn(request: TaskIdRequest): Promise<void> {
	return invoke("delete_kanban_column", { request });
}

// Delete a single kanban card
export function deleteKanbanCard(request: TaskIdRequest): Promise<void> {
	return invoke("delete_kanban_card", { request });
}

// ────────────────────────────
// Filesystem & Dashboard
// ────────────────────────────

// List files in a workspace content subdirectory
export function listWorkspaceFiles(
	path: string,
	subdir: string,
): Promise<WorkspaceFile[]> {
	return invoke("list_workspace_files", { path, subdir });
}

// Create a new empty file in workspace
export function createWorkspaceFile(
	path: string,
	relPath: string,
	name: string,
): Promise<void> {
	return invoke("create_workspace_item", {
		path,
		relPath,
		name,
		isDir: false,
	});
}

// Create a new folder in workspace
export function createWorkspaceFolder(
	path: string,
	relPath: string,
	name: string,
): Promise<void> {
	return invoke("create_workspace_item", {
		path,
		relPath,
		name,
		isDir: true,
	});
}

// Read text contents from workspace file
export function readWorkspaceFile(
	path: string,
	relPath: string,
): Promise<string> {
	return invoke("read_workspace_file", { path, relPath });
}

// Write text contents to workspace file
export function writeWorkspaceFile(
	path: string,
	relPath: string,
	content: string,
): Promise<void> {
	return invoke("write_workspace_file", { path, relPath, content });
}

// Read binary file from workspace as base64 string
export function readWorkspaceBinaryFile(
	path: string,
	relPath: string,
): Promise<string> {
	return invoke("read_workspace_binary_file", { path, relPath });
}

// Write binary base64 data to workspace file
export function writeWorkspaceBinaryFile(
	path: string,
	relPath: string,
	base64Data: string,
): Promise<void> {
	return invoke("write_workspace_binary_file", { path, relPath, base64Data });
}

// Import an external asset file from disk into workspace assets/
export function importAssetFromPath(
	workspacePath: string,
	sourcePath: string,
): Promise<WorkspaceFile> {
	return invoke("import_asset_from_path", { workspacePath, sourcePath });
}

// Delete a workspace file or directory permanently
export function deleteWorkspaceItem(
	path: string,
	relPath: string,
): Promise<void> {
	return invoke("delete_workspace_item", { path, relPath });
}

// Rename a workspace file or directory
export function renameWorkspaceItem(
	path: string,
	relPath: string,
	newName: string,
): Promise<void> {
	return invoke("rename_workspace_item", { path, relPath, newName });
}

// Get aggregate stats for workspace dashboard
export function getWorkspaceStats(path: string): Promise<WorkspaceStats> {
	return invoke("get_workspace_stats", { path });
}

// ────────────────────────────
// Recent workspaces registry
// ────────────────────────────

// Get list of recent workspaces from app registry
export function getRecentWorkspaces(): Promise<WorkspaceInfo[]> {
	return invoke("get_recent_workspaces");
}

// Add workspace to recent workspaces list
export function addRecentWorkspace(workspace: WorkspaceInfo): Promise<void> {
	return invoke("add_recent_workspace", { workspace });
}

// Remove workspace from recent list
export function removeRecentWorkspace(id: string): Promise<void> {
	return invoke("remove_recent_workspace", { id });
}

// ────────────────────────────
// Last workspace (session restoration)
// ────────────────────────────

// Get last opened workspace for automatic restoration
export function getLastWorkspace(): Promise<WorkspaceInfo | null> {
	return invoke("get_last_workspace");
}

// Persist last opened workspace
export function setLastWorkspace(workspace: WorkspaceInfo): Promise<void> {
	return invoke("set_last_workspace", { workspace });
}

// Clear last workspace tracking
export function clearLastWorkspace(): Promise<void> {
	return invoke("clear_last_workspace");
}

// ────────────────────────────
// Security & App Configuration
// ────────────────────────────

// Load application security configuration
export function loadConfig(): Promise<NexsyncConfig> {
	return invoke("load_config_cmd");
}

// Save application security configuration
export function saveConfig(config: NexsyncConfig): Promise<void> {
	return invoke("save_config_cmd", { config });
}

// Check if a directory path is valid and allowed
export function validateAllowedRoot(workspacePath: string): Promise<boolean> {
	return invoke("validate_allowed_root_cmd", { workspacePath });
}
