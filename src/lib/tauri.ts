// Typed wrapper around Tauri IPC commands.
// All `invoke` calls should go through these functions so the UI never calls
// commands by raw string — keeping the frontend/backend command surface in
// sync and type-safe.

import { invoke } from "@tauri-apps/api/core";

import type { WorkspaceInfo } from "@/types/workspace";

export interface CreateWorkspaceRequest {
	name: string;
	description: string;
	path: string;
}

export function createWorkspace(
	request: CreateWorkspaceRequest,
): Promise<void> {
	return invoke("create_workspace", { request });
}

export function importWorkspace(path: string): Promise<WorkspaceInfo> {
	return invoke("import_workspace", { path });
}
