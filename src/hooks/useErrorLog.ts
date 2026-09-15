// React
import { useCallback } from "react";

// Tauri
import { logError } from "@/lib/tauri";

// Types
import type { ErrorRecord } from "@/types/workspace";

// Categorized error sources for greppable logging
export type ErrorSource =
	| "workspace_load"
	| "workspace_save"
	| "workspace_stats"
	| "startup"
	| "recent_load"
	| "dialog"
	| "render"
	| "files"
	| "tasks"
	| "kanban"
	| "members"
	| "settings"
	| (string & {});

interface ErrorContext {
	source: ErrorSource;
	workspace?: string;
}

// Hook providing a fire-and-forget error logging function to append to errors.jsonl
export function useErrorLog() {
	return useCallback((error: unknown, context: ErrorContext) => {
		// Construct standardized error record
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

		// Fire-and-forget logging to backend without blocking UI
		logError(entry).catch((err) => {
			console.error("Failed to write to error log:", err);
		});
	}, []);
}
