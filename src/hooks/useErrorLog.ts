// React
import { useCallback } from "react";

// Tauri
import { logError } from "@/lib/tauri";

// Types
import type { ErrorRecord } from "@/types/workspace";

// A small selection of known error sources, kept as strings so the stored
// log is greppable. Extend this union as the app grows.
export type ErrorSource =
	| "workspace_load"
	| "workspace_save"
	| "workspace_stats"
	| "startup"
	| "recent_load"
	| "dialog"
	| "render"
	| "files_list"
	| "files_upload"
	| "files_delete"
	| "files_rename"
	| "files_create";

interface ErrorContext {
	source: ErrorSource;
	workspace?: string;
}

/**
 * Returns a fire-and-forget function that appends an error to the app-level
 * error log (`errors.jsonl`). Logging never blocks or crashes the UI — if the
 * write fails, the error is only reported to the console.
 */
export function useErrorLog() {
	return useCallback((error: unknown, context: ErrorContext) => {
		const entry: ErrorRecord = {
			timestamp: new Date().toISOString(),
			message:
				error instanceof Error ? error.message : String(error ?? ""),
			source: context.source,
			...(context.workspace !== undefined && {
				workspace: context.workspace,
			}),
			...(error instanceof Error && error.stack ?
				{ detail: error.stack }
			:	{}),
		};

		logError(entry).catch((err) => {
			console.error("Failed to write to error log:", err);
		});
	}, []);
}
