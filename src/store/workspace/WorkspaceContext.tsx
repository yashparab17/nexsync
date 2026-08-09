// React / React Router
import {
	createContext,
	useContext,
	useState,
	useCallback,
	type ReactNode,
} from "react";

// Types
import type {
	WorkspaceInfo,
	WorkspaceMetadata,
	Settings,
	Members,
	Permissions,
	History,
} from "@/types/workspace";

// Tauri
import { readWorkspaceMetadata, writeWorkspaceMetadata } from "@/lib/tauri";

interface WorkspaceContextType {
	// Core state
	workspace: WorkspaceInfo | null;
	metadata: WorkspaceMetadata | null;
	isLoading: boolean;
	error: string | null;

	// Actions
	setWorkspace: (workspace: WorkspaceInfo) => void;
	loadWorkspace: (path: string) => Promise<void>;
	saveWorkspace: () => Promise<void>;
	clearWorkspace: () => void;

	// Metadata updaters (mutate local state; call saveWorkspace to persist)
	updateSettings: (settings: Partial<Settings>) => void;
	updateMembers: (members: Members) => void;
	addActivityEvent: (action: string, detail: string) => void;
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
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// ── Load full workspace metadata from disk ──
	const loadWorkspace = useCallback(async (path: string) => {
		setIsLoading(true);
		setError(null);

		try {
			const meta = await readWorkspaceMetadata(path);
			setMetadata(meta);
			setWorkspace(meta.workspace);
		} catch (err) {
			setError(String(err));
			setMetadata(null);
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

	// ── Clear everything ──
	const clearWorkspace = useCallback(() => {
		setWorkspace(null);
		setMetadata(null);
		setError(null);
	}, []);

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

	const addActivityEvent = useCallback((action: string, detail: string) => {
		setMetadata((prev) => {
			if (!prev) return prev;
			const event = {
				id: crypto.randomUUID(),
				timestamp: new Date().toISOString(),
				action,
				detail,
			};
			return {
				...prev,
				activity: {
					events: [event, ...prev.activity.events],
				},
			};
		});
	}, []);

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

	return (
		<WorkspaceContext.Provider
			value={{
				workspace,
				metadata,
				isLoading,
				error,
				setWorkspace: handleSetWorkspace,
				loadWorkspace,
				saveWorkspace,
				clearWorkspace,
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
