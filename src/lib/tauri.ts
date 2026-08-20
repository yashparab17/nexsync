// Typed wrapper around Tauri IPC commands.
// All `invoke` calls should go through these functions so the UI never calls
// commands by raw string — keeping the frontend/backend command surface in
// sync and type-safe.

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWorkspaceSession } from "@/store/workspace/WorkspaceContext";

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
} from "@/types/workspace";

// ────────────────────────────
// Helpers
// ────────────────────────────

function withSession<T>(fn: (sessionId: string) => Promise<T>): Promise<T> {
	const session = getCurrentWorkspaceSession();
	if (!session) {
		return Promise.reject(
			new Error(
				"No active workspace session. Please open a workspace first.",
			),
		);
	}
	return fn(session);
}

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
// Workspace creation / import (C1: session required)
// ────────────────────────────

export function createWorkspace(
	request: CreateWorkspaceRequest,
): Promise<WorkspaceInfo> {
	return withSession((sessionId) =>
		invoke("create_workspace", { request, sessionId }),
	);
}

export function importWorkspace(path: string): Promise<WorkspaceInfo> {
	return withSession((sessionId) =>
		invoke("import_workspace", { path, sessionId }),
	);
}

// ────────────────────────────
// Metadata read / write (C1: session required)
// ────────────────────────────

export function readWorkspaceMetadata(
	path: string,
): Promise<WorkspaceMetadata> {
	return withSession((sessionId) =>
		invoke("read_workspace_metadata", { path, sessionId }),
	);
}

export function writeWorkspaceMetadata(
	request: UpdateMetadataRequest,
): Promise<void> {
	return withSession((sessionId) =>
		invoke("write_workspace_metadata", { request, sessionId }),
	);
}

// ────────────────────────────
// Task commands (C1: session required)
// ────────────────────────────

export function getTasks(path: string): Promise<Task[]> {
	return withSession((sessionId) => invoke("get_tasks", { path, sessionId }));
}

export function createTask(request: TaskRequest): Promise<Task> {
	return withSession((sessionId) =>
		invoke("create_task", { request, sessionId }),
	);
}

export function updateTask(request: TaskRequest): Promise<void> {
	return withSession((sessionId) =>
		invoke("update_task", { request, sessionId }),
	);
}

export function deleteTask(request: TaskIdRequest): Promise<void> {
	return withSession((sessionId) =>
		invoke("delete_task", { request, sessionId }),
	);
}

// ────────────────────────────
// Kanban commands (C1: session required)
// ────────────────────────────

export function getKanban(path: string): Promise<KanbanColumn[]> {
	return withSession((sessionId) =>
		invoke("get_kanban", { path, sessionId }),
	);
}

export function createKanbanColumn(
	request: KanbanColumnRequest,
): Promise<KanbanColumn> {
	return withSession((sessionId) =>
		invoke("create_kanban_column", { request, sessionId }),
	);
}

// Slightly different: card creation needs column context
export function createKanbanCard(
	request: KanbanCardRequest,
): Promise<KanbanCard> {
	return withSession((sessionId) =>
		invoke("create_kanban_card", { request, sessionId }),
	);
}

export function updateKanbanCard(request: KanbanCardRequest): Promise<void> {
	return withSession((sessionId) =>
		invoke("update_kanban_card", { request, sessionId }),
	);
}

export function moveKanbanCard(request: MoveCardRequest): Promise<void> {
	return withSession((sessionId) =>
		invoke("move_kanban_card", { request, sessionId }),
	);
}

export function deleteKanbanColumn(request: TaskIdRequest): Promise<void> {
	return withSession((sessionId) =>
		invoke("delete_kanban_column", { request, sessionId }),
	);
}

export function deleteKanbanCard(request: TaskIdRequest): Promise<void> {
	return withSession((sessionId) =>
		invoke("delete_kanban_card", { request, sessionId }),
	);
}

// ────────────────────────────
// Filesystem / dashboard (C1: session required)
// ────────────────────────────

export function listWorkspaceFiles(
	path: string,
	subdir: string,
): Promise<WorkspaceFile[]> {
	return withSession((sessionId) =>
		invoke("list_workspace_files", { path, subdir, sessionId }),
	);
}

/** Creates a new empty file. `relPath` is the parent directory (e.g. `files/docs`). */
export function createWorkspaceFile(
	path: string,
	relPath: string,
	name: string,
): Promise<void> {
	return withSession((sessionId) =>
		invoke("create_workspace_item", {
			path,
			relPath,
			name,
			isDir: false,
			sessionId,
		}),
	);
}

/** Creates a new folder. `relPath` is the parent directory. */
export function createWorkspaceFolder(
	path: string,
	relPath: string,
	name: string,
): Promise<void> {
	return withSession((sessionId) =>
		invoke("create_workspace_item", {
			path,
			relPath,
			name,
			isDir: true,
			sessionId,
		}),
	);
}

/** Reads the text contents of a workspace file. */
export function readWorkspaceFile(
	path: string,
	relPath: string,
): Promise<string> {
	return withSession((sessionId) =>
		invoke("read_workspace_file", { path, relPath, sessionId }),
	);
}

/** Writes text contents to a workspace file. */
export function writeWorkspaceFile(
	path: string,
	relPath: string,
	content: string,
): Promise<void> {
	return withSession((sessionId) =>
		invoke("write_workspace_file", { path, relPath, content, sessionId }),
	);
}

/** Permanently deletes a workspace file or folder (folders are recursive). */
export function deleteWorkspaceItem(
	path: string,
	relPath: string,
): Promise<void> {
	return withSession((sessionId) =>
		invoke("delete_workspace_item", { path, relPath, sessionId }),
	);
}

/** Renames a workspace file or folder. */
export function renameWorkspaceItem(
	path: string,
	relPath: string,
	newName: string,
): Promise<void> {
	return withSession((sessionId) =>
		invoke("rename_workspace_item", { path, relPath, newName, sessionId }),
	);
}

export function getWorkspaceStats(path: string): Promise<WorkspaceStats> {
	return withSession((sessionId) =>
		invoke("get_workspace_stats", { path, sessionId }),
	);
}

// ────────────────────────────
// Recent workspaces registry (C1: session required for consistency)
// ────────────────────────────

export function getRecentWorkspaces(): Promise<WorkspaceInfo[]> {
	return withSession((sessionId) =>
		invoke("get_recent_workspaces", { sessionId }),
	);
}

export function addRecentWorkspace(workspace: WorkspaceInfo): Promise<void> {
	return withSession((sessionId) =>
		invoke("add_recent_workspace", { workspace, sessionId }),
	);
}

export function removeRecentWorkspace(id: string): Promise<void> {
	return withSession((sessionId) =>
		invoke("remove_recent_workspace", { id, sessionId }),
	);
}

// ────────────────────────────
// Last workspace (session restoration)
// ────────────────────────────

export function getLastWorkspace(): Promise<WorkspaceInfo | null> {
	return withSession((sessionId) =>
		invoke("get_last_workspace", { sessionId }),
	);
}

export function setLastWorkspace(workspace: WorkspaceInfo): Promise<void> {
	return withSession((sessionId) =>
		invoke("set_last_workspace", { workspace, sessionId }),
	);
}

export function clearLastWorkspace(): Promise<void> {
	return withSession((sessionId) =>
		invoke("clear_last_workspace", { sessionId }),
	);
}
