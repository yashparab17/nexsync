// Typed wrapper around Tauri IPC commands.
// All `invoke` calls should go through these functions so the UI never calls
// commands by raw string — keeping the frontend/backend command surface in
// sync and type-safe.

import { invoke } from "@tauri-apps/api/core";

import type {
	WorkspaceInfo,
	WorkspaceMetadata,
	WorkspaceFile,
	WorkspaceStats,
	ErrorRecord,
	CreateWorkspaceRequest,
	UpdateMetadataRequest,
} from "@/types/workspace";

// ────────────────────────────
// Error logging
// ────────────────────────────

/**
 * Appends an entry to the app-level error log (`errors.jsonl`).
 * Fire-and-forget: callers should never block the UI on this.
 */
export function logError(entry: ErrorRecord): Promise<void> {
	return invoke("log_error", { entry });
}

// ────────────────────────────
// Workspace creation / import
// ────────────────────────────

export function createWorkspace(
	request: CreateWorkspaceRequest,
): Promise<WorkspaceInfo> {
	return invoke("create_workspace", { request });
}

export function importWorkspace(path: string): Promise<WorkspaceInfo> {
	return invoke("import_workspace", { path });
}

// ────────────────────────────
// Metadata read / write
// ────────────────────────────

export function readWorkspaceMetadata(
	path: string,
): Promise<WorkspaceMetadata> {
	return invoke("read_workspace_metadata", { path });
}

export function writeWorkspaceMetadata(
	request: UpdateMetadataRequest,
): Promise<void> {
	return invoke("write_workspace_metadata", { request });
}

// ────────────────────────────
// Feature-scoped JSON (per-feature state files)
// ────────────────────────────

/**
 * Reads a single feature-scoped JSON file from `<workspace>/.nexsync/<name>.json`.
 * Returns `null` if the file does not exist. Use this for feature state that
 * should persist independently of the core metadata blob (e.g. tasks, kanban).
 */
export async function readWorkspaceJson<T>(
	path: string,
	name: string,
): Promise<T | null> {
	return (await invoke("read_workspace_json", { path, name })) as T | null;
}

/**
 * Writes a single feature-scoped JSON file to `<workspace>/.nexsync/<name>.json`.
 */
export function writeWorkspaceJson(
	path: string,
	name: string,
	data: unknown,
): Promise<void> {
	return invoke("write_workspace_json", { path, name, data });
}

// ────────────────────────────
// Filesystem / dashboard
// ────────────────────────────

export function listWorkspaceFiles(
	path: string,
	subdir: string,
): Promise<WorkspaceFile[]> {
	return invoke("list_workspace_files", { path, subdir });
}

/** Creates a new empty file. `relPath` is the parent directory (e.g. `files/docs`). */
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

/** Creates a new folder. `relPath` is the parent directory. */
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

/** Reads the text contents of a workspace file. */
export function readWorkspaceFile(
	path: string,
	relPath: string,
): Promise<string> {
	return invoke("read_workspace_file", { path, relPath });
}

/** Writes text contents to a workspace file. */
export function writeWorkspaceFile(
	path: string,
	relPath: string,
	content: string,
): Promise<void> {
	return invoke("write_workspace_file", { path, relPath, content });
}

/** Permanently deletes a workspace file or folder (folders are recursive). */
export function deleteWorkspaceItem(
	path: string,
	relPath: string,
): Promise<void> {
	return invoke("delete_workspace_item", { path, relPath });
}

/** Renames a workspace file or folder. */
export function renameWorkspaceItem(
	path: string,
	relPath: string,
	newName: string,
): Promise<void> {
	return invoke("rename_workspace_item", { path, relPath, newName });
}

export function getWorkspaceStats(path: string): Promise<WorkspaceStats> {
	return invoke("get_workspace_stats", { path });
}

// ────────────────────────────
// Recent workspaces registry
// ────────────────────────────

export function getRecentWorkspaces(): Promise<WorkspaceInfo[]> {
	return invoke("get_recent_workspaces");
}

export function addRecentWorkspace(workspace: WorkspaceInfo): Promise<void> {
	return invoke("add_recent_workspace", { workspace });
}

export function removeRecentWorkspace(id: string): Promise<void> {
	return invoke("remove_recent_workspace", { id });
}

// ────────────────────────────
// Last workspace (session restoration)
// ────────────────────────────

export function getLastWorkspace(): Promise<WorkspaceInfo | null> {
	return invoke("get_last_workspace");
}

export function setLastWorkspace(workspace: WorkspaceInfo): Promise<void> {
	return invoke("set_last_workspace", { workspace });
}

export function clearLastWorkspace(): Promise<void> {
	return invoke("clear_last_workspace");
}
