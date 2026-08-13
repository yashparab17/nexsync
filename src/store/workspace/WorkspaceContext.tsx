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

// Tauri
import {
	readWorkspaceMetadata,
	writeWorkspaceMetadata,
	getWorkspaceStats,
	addRecentWorkspace,
	setLastWorkspace,
	clearLastWorkspace,
} from "@/lib/tauri";

interface WorkspaceContextType {
	// Core state
	workspace: WorkspaceInfo | null;
	metadata: WorkspaceMetadata | null;
	stats: WorkspaceStats | null;
	isLoading: boolean;
	error: string | null;

	// Actions
	setWorkspace: (workspace: WorkspaceInfo) => void;
	loadWorkspace: (path: string) => Promise<void>;
	saveWorkspace: () => Promise<void>;
	clearWorkspace: () => Promise<void>;
	refreshStats: () => Promise<void>;

	// Metadata updaters (mutate local state; call saveWorkspace to persist)
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

export function WorkspaceProvider({ children }: { children: ReactNode }) {
	const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
	const [metadata, setMetadata] = useState<WorkspaceMetadata | null>(null);
	const [stats, setStats] = useState<WorkspaceStats | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// ── Load full workspace metadata from disk ──
	const loadWorkspace = useCallback(async (path: string) => {
		setIsLoading(true);
		setError(null);

		try {
			const [meta, nextStats] = await Promise.all([
				readWorkspaceMetadata(path),
				getWorkspaceStats(path),
			]);

			// Update last_opened timestamp on load.
			meta.history.last_opened = new Date().toISOString();

			setMetadata(meta);
			setStats(nextStats);
			setWorkspace(meta.workspace);

			// Update the app-level registries:
			// 1. Add to recent workspaces list (for the Welcome page)
			// 2. Set as the last opened workspace (for session restoration)
			await addRecentWorkspace(meta.workspace);
			await setLastWorkspace(meta.workspace);
		} catch (err) {
			setError(String(err));
			setMetadata(null);
			setStats(null);
			setWorkspace(null);
		} finally {
			setIsLoading(false);
		}
	}, []);

	// ── Persist all metadata to disk ──
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
		}
	}, [metadata]);

	// ── Set workspace from an already-loaded WorkspaceInfo ──
	const handleSetWorkspace = useCallback((ws: WorkspaceInfo) => {
		setWorkspace(ws);
	}, []);

	// ── Refresh the dashboard stats from disk ──
	const refreshStats = useCallback(async () => {
		if (!workspace) return;

		try {
			const nextStats = await getWorkspaceStats(workspace.path);
			setStats(nextStats);
		} catch (err) {
			setError(String(err));
		}
	}, [workspace]);

	// ── Clear everything (saves first, then clears last-workspace tracking) ──
	const clearWorkspace = useCallback(async () => {
		if (metadata) {
			await saveWorkspace();
		}
		// Clear the last-workspace file so the app opens to Welcome
		// on next startup instead of re-opening this workspace.
		await clearLastWorkspace();
		setWorkspace(null);
		setMetadata(null);
		setStats(null);
		setError(null);
	}, [metadata, saveWorkspace]);

	// ── Metadata updaters ──
	const updateSettings = useCallback((settings: Partial<Settings>) => {
		setMetadata((prev) => {
			if (!prev) return prev;
			return {
				...prev,
				settings: { ...prev.settings, ...settings },
			};
		});
	}, []);

	const updateMembers = useCallback((members: Members) => {
		setMetadata((prev) => {
			if (!prev) return prev;
			return { ...prev, members };
		});
	}, []);

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

	const updatePermissions = useCallback((permissions: Permissions) => {
		setMetadata((prev) => {
			if (!prev) return prev;
			return { ...prev, permissions };
		});
	}, []);

	const updateHistory = useCallback((history: Partial<History>) => {
		setMetadata((prev) => {
			if (!prev) return prev;
			return {
				...prev,
				history: { ...prev.history, ...history },
			};
		});
	}, []);

	const clearError = useCallback(() => setError(null), []);

	// ── Auto-save on window close ──
	useEffect(() => {
		const handleBeforeUnload = () => {
			if (metadata) {
				// Fire-and-forget: the browser/Tauri will wait for
				// sendBeacon or the page will be unloaded anyway.
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

export function useWorkspace() {
	const context = useContext(WorkspaceContext);

	if (!context) {
		throw new Error("useWorkspace must be used inside WorkspaceProvider");
	}

	return context;
}
