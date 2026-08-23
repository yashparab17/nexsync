// React / React Router
import {
	createContext,
	useContext,
	useState,
	useCallback,
	useEffect,
	type ReactNode,
} from "react";

// Types
import type {
	WorkspaceInfo,
	WorkspaceMetadata,
	WorkspaceStats,
	Settings,
	Members,
	Permissions,
	History,
	ActivityEvent,
} from "@/types/workspace";

// Tauri IPC
import {
	readWorkspaceMetadata,
	writeWorkspaceMetadata,
	getWorkspaceStats,
	addRecentWorkspace,
	setLastWorkspace,
	clearLastWorkspace,
	setActiveSessionToken,
	getActiveSessionToken,
} from "@/lib/tauri";

// Hooks
import { useErrorLog } from "@/hooks/useErrorLog";

interface WorkspaceContextType {
	// Core state
	workspace: WorkspaceInfo | null;
	metadata: WorkspaceMetadata | null;
	stats: WorkspaceStats | null;
	isLoading: boolean;
	error: string | null;
	failedWorkspace: WorkspaceInfo | null;

	// Actions
	setWorkspace: (workspace: WorkspaceInfo) => void;
	loadWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
	saveWorkspace: () => Promise<void>;
	clearWorkspace: () => Promise<void>;
	refreshStats: () => Promise<void>;

	// Metadata updaters (mutates local state; saveWorkspace persists)
	updateSettings: (settings: Partial<Settings>) => void;
	updateMembers: (members: Members) => void;
	addActivityEvent: (
		action: string,
		detail: string,
		target?: string,
		targetType?: string,
	) => void;
	updatePermissions: (permissions: Permissions) => void;
	updateHistory: (history: Partial<History>) => void;

	// Error management
	clearError: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(
	undefined,
);

// Provides workspace data, metadata updates, and disk persistence to the component tree
export function WorkspaceProvider({ children }: { children: ReactNode }) {
	const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
	const logError = useErrorLog();
	const [metadata, setMetadata] = useState<WorkspaceMetadata | null>(null);
	const [stats, setStats] = useState<WorkspaceStats | null>(null);
	const [failedWorkspace, setFailedWorkspace] =
		useState<WorkspaceInfo | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Load full workspace metadata and stats from SQLite database
	const loadWorkspace = useCallback(
		async (ws: WorkspaceInfo) => {
			setIsLoading(true);
			setError(null);
			setFailedWorkspace(null);

			try {
				const [meta, nextStats] = await Promise.all([
					readWorkspaceMetadata(ws.path),
					getWorkspaceStats(ws.path),
				]);

				// Update last opened timestamp
				meta.history.last_opened = new Date().toISOString();

				setMetadata(meta);
				setStats(nextStats);
				setWorkspace(meta.workspace);
				setActiveSessionToken(meta.workspace.id);

				// Update recent workspaces and session restoration registry
				await addRecentWorkspace(meta.workspace);
				await setLastWorkspace(meta.workspace);
			} catch (err) {
				setError(String(err));
				setFailedWorkspace(ws);
				setMetadata(null);
				setStats(null);
				setWorkspace(null);
				setActiveSessionToken(null);
				logError(err, { source: "workspace_load", workspace: ws.path });
				throw err;
			} finally {
				setIsLoading(false);
			}
		},
		[logError],
	);

	// Persist in-memory metadata changes to SQLite database
	const saveWorkspace = useCallback(async () => {
		if (!metadata) return;

		try {
			await writeWorkspaceMetadata({
				path: metadata.workspace.path,
				metadata,
			});
			setError(null);
		} catch (err) {
			setError(String(err));
			logError(err, {
				source: "workspace_save",
				workspace: metadata.workspace.path,
			});
		}
	}, [metadata, logError]);

	// Set active workspace directly from existing info
	const handleSetWorkspace = useCallback((ws: WorkspaceInfo) => {
		setWorkspace(ws);
	}, []);

	// Refresh workspace metrics from disk
	const refreshStats = useCallback(async () => {
		if (!workspace) return;

		try {
			const nextStats = await getWorkspaceStats(workspace.path);
			setStats(nextStats);
		} catch (err) {
			setError(String(err));
			logError(err, {
				source: "workspace_stats",
				workspace: workspace.path,
			});
		}
	}, [workspace, logError]);

	// Save and unload current workspace, clearing session tracking
	const clearWorkspace = useCallback(async () => {
		if (metadata) {
			await saveWorkspace();
		}
		// Clear last workspace file so app reopens to Welcome page
		await clearLastWorkspace();
		setActiveSessionToken(null);
		setWorkspace(null);
		setMetadata(null);
		setStats(null);
		setFailedWorkspace(null);
		setError(null);
	}, [metadata, saveWorkspace]);

	// Update workspace settings in local state
	const updateSettings = useCallback((settings: Partial<Settings>) => {
		setMetadata((prev) => {
			if (!prev) return prev;
			return {
				...prev,
				settings: { ...prev.settings, ...settings },
			};
		});
	}, []);

	// Update workspace collaborators in local state
	const updateMembers = useCallback((members: Members) => {
		setMetadata((prev) => {
			if (!prev) return prev;
			return { ...prev, members };
		});
	}, []);

	// Prepend a new activity event to the workspace history
	const addActivityEvent = useCallback(
		(
			action: string,
			detail: string,
			target?: string,
			targetType?: string,
		) => {
			setMetadata((prev) => {
				if (!prev) return prev;
				const event: ActivityEvent = {
					id: crypto.randomUUID(),
					timestamp: new Date().toISOString(),
					action,
					detail,
					...(target !== undefined && { target }),
					...(targetType !== undefined && {
						target_type: targetType,
					}),
				};
				return {
					...prev,
					activity: {
						events: [event, ...prev.activity.events],
					},
				};
			});
		},
		[],
	);

	// Update role permissions in local state
	const updatePermissions = useCallback((permissions: Permissions) => {
		setMetadata((prev) => {
			if (!prev) return prev;
			return { ...prev, permissions };
		});
	}, []);

	// Update file navigation history in local state
	const updateHistory = useCallback((history: Partial<History>) => {
		setMetadata((prev) => {
			if (!prev) return prev;
			return {
				...prev,
				history: { ...prev.history, ...history },
			};
		});
	}, []);

	// Reset error state
	const clearError = useCallback(() => {
		setError(null);
		setFailedWorkspace(null);
	}, []);

	// Auto-save metadata on window unload
	useEffect(() => {
		const handleBeforeUnload = () => {
			if (metadata) {
				saveWorkspace();
			}
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		return () =>
			window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [metadata, saveWorkspace]);

	return (
		<WorkspaceContext.Provider
			value={{
				workspace,
				metadata,
				stats,
				isLoading,
				error,
				failedWorkspace,
				setWorkspace: handleSetWorkspace,
				loadWorkspace,
				saveWorkspace,
				clearWorkspace,
				refreshStats,
				updateSettings,
				updateMembers,
				addActivityEvent,
				updatePermissions,
				updateHistory,
				clearError,
			}}
		>
			{children}
		</WorkspaceContext.Provider>
	);
}

// Hook to access the workspace context
export function useWorkspace() {
	const context = useContext(WorkspaceContext);

	if (!context) {
		throw new Error("useWorkspace must be used inside WorkspaceProvider");
	}

	return context;
}

// Get the current active session ID
export function getCurrentWorkspaceSession(): string | null {
	return getActiveSessionToken();
}
