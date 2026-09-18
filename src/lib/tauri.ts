// Typed wrapper around Tauri IPC commands
// All backend invocations go through these functions to keep IPC calls type-safe
// X25519 operations fall back to @noble/curves when running outside Tauri (e.g. plain browser)

import { invoke } from "@tauri-apps/api/core";
import { x25519 } from "@noble/curves/ed25519.js";

// Returns true when running inside a Tauri desktop window
function isTauri(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Minimal base64url helpers used only for X25519 key encoding below
function _toB64Url(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i++)
		binary += String.fromCharCode(bytes[i]);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=/g, "");
}
function _fromB64Url(b64: string): Uint8Array {
	const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
	const s = padded + "=".repeat((4 - (padded.length % 4)) % 4);
	const binary = atob(s);
	return new Uint8Array(binary.length).map((_, i) => binary.charCodeAt(i));
}

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
	YjsDocSummary,
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

// List all Yjs document snapshots stored in workspace database
export function listYjsDocs(workspacePath: string): Promise<YjsDocSummary[]> {
	return invoke("list_yjs_docs", {
		workspacePath,
	});
}

// ────────────────────────────
// P2P E2EE Handshake (X25519)
// ────────────────────────────

export interface X25519KeyPair {
	publicKey: string;
	secretKey: string;
}

// Generate a fresh ephemeral X25519 keypair.
// Uses the Rust backend when running in Tauri; falls back to @noble/curves
// (pure JS, same wire format) when running in a plain browser.
export async function generateX25519KeyPair(): Promise<X25519KeyPair> {
	if (isTauri()) {
		const result = await invoke<{ public_key: string; secret_key: string }>(
			"x25519_generate_keypair",
		);
		return { publicKey: result.public_key, secretKey: result.secret_key };
	}
	// Browser fallback: @noble/curves produces the same raw 32-byte format as x25519-dalek
	const secretBytes = x25519.utils.randomSecretKey();
	const publicBytes = x25519.getPublicKey(secretBytes);
	return {
		publicKey: _toB64Url(publicBytes),
		secretKey: _toB64Url(secretBytes),
	};
}

// Compute the raw X25519 ECDH shared secret for a P2P handshake.
// Callers MUST run the result through HKDF before using it as an AES key.
export function deriveX25519SharedSecret(
	secretKey: string,
	peerPublicKey: string,
): Promise<string> {
	if (isTauri()) {
		return invoke("x25519_derive_shared_secret", {
			secretKey,
			peerPublicKey,
		});
	}
	// Browser fallback: same DH math, same raw 32-byte output as x25519-dalek
	const shared = x25519.getSharedSecret(
		_fromB64Url(secretKey),
		_fromB64Url(peerPublicKey),
	);
	return Promise.resolve(_toB64Url(shared));
}
