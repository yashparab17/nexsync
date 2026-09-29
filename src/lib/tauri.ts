// Typed wrapper around Tauri IPC commands
// All backend invocations go through these functions to keep IPC calls type-safe
// P2P commands live in src/lib/p2p/transport.ts

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
	WorkspaceInfo,
	WorkspaceMetadata,
	WorkspaceFile,
	WorkspaceStats,
	FileVersion,
	ErrorRecord,
	TrashItem,
	DeleteOutcome,
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
export function createWorkspaceSession(workspacePath: string): Promise<string> {
	return invoke("create_workspace_session", { workspacePath });
}

// Close an active workspace session
export function closeWorkspaceSession(sessionId: string): Promise<void> {
	return invoke("close_workspace_session", { sessionId });
}

// Fetch session info including role and created timestamp
export function getCurrentSessionInfo(
	sessionId: string,
): Promise<{
	sessionId: string;
	workspacePath: string;
	userRole: string;
	createdAt: string;
} | null> {
	return invoke("get_current_session_info", { sessionId });
}

// ────────────────────────────
// Error logging
// ────────────────────────────

// Append an error record to app-level error log
export function logError(entry: ErrorRecord): Promise<void> {
	return invoke("log_error", { entry });
}

// Read the most recent error records, newest first
export function getErrorLog(limit = 200): Promise<ErrorRecord[]> {
	return invoke("get_error_log", { limit });
}

// Delete the app-level error log
export function clearErrorLog(): Promise<void> {
	return invoke("clear_error_log");
}

// Move a whole workspace to the operating system recycle bin
export function deleteWorkspace(path: string): Promise<DeleteOutcome> {
	return invoke("delete_workspace", { path });
}

// ────────────────────────────
// Trash
// ────────────────────────────

// List deleted items, newest first
export function listTrash(path: string): Promise<TrashItem[]> {
	return invoke("list_trash", { path });
}

// Move a trashed item back to where it was
export function restoreTrashItem(path: string, id: string): Promise<void> {
	return invoke("restore_trash_item", { path, id });
}

// Permanently delete one trashed item
export function purgeTrashItem(path: string, id: string): Promise<void> {
	return invoke("purge_trash_item", { path, id });
}

// Permanently delete everything in the trash
export function emptyTrash(path: string): Promise<void> {
	return invoke("empty_trash", { path });
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

// ────────────────────────────
// Yjs CRDT Binary Persistence
// ────────────────────────────

// Convert Uint8Array to base64 string for IPC transmission
export function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = "";
	const len = bytes.byteLength;
	const chunkSize = 0x8000;
	for (let i = 0; i < len; i += chunkSize) {
		const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
		binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
	}
	return btoa(binary);
}

// Convert base64 string from IPC transmission to Uint8Array
export function base64ToUint8Array(base64: string): Uint8Array {
	const binary = atob(base64);
	const len = binary.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

// Retrieve stored Yjs CRDT document binary state from SQLite
export async function getYjsDoc(
	workspacePath: string,
	docId: string,
): Promise<Uint8Array | null> {
	const base64Str = await invoke<string | null>("get_yjs_doc", {
		workspacePath,
		docId,
	});
	if (!base64Str) return null;
	return base64ToUint8Array(base64Str);
}

// Ids of every document that has stored CRDT state
export function listYjsDocs(workspacePath: string): Promise<string[]> {
	return invoke("list_yjs_docs", { workspacePath });
}

// Persist Yjs CRDT document binary state into SQLite
export async function saveYjsDoc(
	workspacePath: string,
	docId: string,
	state: Uint8Array,
): Promise<void> {
	const base64Str = uint8ArrayToBase64(state);
	await invoke("save_yjs_doc", {
		workspacePath,
		docId,
		state: base64Str,
	});
}

// Move a Yjs document's binary CRDT state to a new doc id, e.g. after a file rename
export function renameYjsDoc(
	workspacePath: string,
	oldDocId: string,
	newDocId: string,
): Promise<void> {
	return invoke("rename_yjs_doc", {
		workspacePath,
		oldDocId,
		newDocId,
	});
}

// Delete Yjs CRDT document binary state from SQLite
export function deleteYjsDoc(
	workspacePath: string,
	docId: string,
): Promise<void> {
	return invoke("delete_yjs_doc", {
		workspacePath,
		docId,
	});
}

// ────────────────────────────
// Editor: run output and system files
// ────────────────────────────

// One line of output from a command started with runCommand
export interface RunOutput {
	runId: string;
	stream: "stdout" | "stderr";
	text: string;
}

export interface RunExit {
	runId: string;
	code: number | null;
	stopped: boolean;
	error: string | null;
}

// Start a command inside a folder of the editor area; output arrives through onRunOutput
export function runCommand(workspacePath: string, dir: string, command: string): Promise<string> {
	return invoke("run_command", { workspacePath, dir, command });
}

export function killRun(runId: string): Promise<void> {
	return invoke("kill_run", { runId });
}

export const onRunOutput = (handler: (event: RunOutput) => void) =>
	listen<RunOutput>("editor://run-output", (e) => handler(e.payload));

export const onRunExit = (handler: (event: RunExit) => void) =>
	listen<RunExit>("editor://run-exit", (e) => handler(e.payload));

// Open a workspace file, such as a Word document, in the default app for its type
export function openWorkspaceFile(workspacePath: string, relPath: string): Promise<void> {
	return invoke("open_workspace_file", { workspacePath, relPath });
}

// ────────────────────────────
// Version history and export
// ────────────────────────────

// The saved versions of a file, newest first
export function listFileVersions(path: string, relPath: string): Promise<FileVersion[]> {
	return invoke("list_file_versions", { path, relPath });
}

// Keep the text an editor holds now as a version: a periodic snapshot, or a named one
export function recordFileVersion(
	path: string,
	relPath: string,
	content: string,
	options: { label?: string; author?: string } = {},
): Promise<void> {
	return invoke("record_file_version", {
		path,
		relPath,
		content,
		source: options.label ? "named" : "auto",
		label: options.label ?? null,
		author: options.author ?? null,
	});
}

// Keep a version a collaborator named, if this device has the file; resolves to whether it was added
export function receiveNamedVersion(
	path: string,
	relPath: string,
	content: string,
	label: string,
	author: string,
): Promise<boolean> {
	return invoke("receive_named_version", { path, relPath, content, label, author });
}

// A version read as text, for the preview and the diff
export function readFileVersion(path: string, id: number): Promise<string> {
	return invoke("read_file_version", { path, id });
}

// Put a version back on disk (what was there is kept as a version first); returns the file's path
export function restoreFileVersion(path: string, id: number): Promise<string> {
	return invoke("restore_file_version", { path, id });
}

// Zip workspace folders to a path chosen in the save dialog; returns how many files went in
export function exportZip(path: string, roots: string[], dest: string): Promise<number> {
	return invoke("export_zip", { path, roots, dest });
}

// Save a finished export, such as a note as Markdown or PDF, to a path chosen in the save dialog
export function writeExportFile(path: string, dest: string, contentBase64: string): Promise<void> {
	return invoke("write_export_file", { path, dest, contentBase64 });
}
