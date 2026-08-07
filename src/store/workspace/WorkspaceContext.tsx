// React / React Router
import { createContext, useContext, useState, type ReactNode } from "react";

// Types
import type { WorkspaceInfo } from "@/types/workspace";

interface WorkspaceContextType {
	workspace: WorkspaceInfo | null;
	setWorkspace: (workspace: WorkspaceInfo) => void;
	clearWorkspace: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(
	undefined,
);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
	const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);

	const clearWorkspace = () => {
		setWorkspace(null);
	};

	return (
		<WorkspaceContext.Provider
			value={{
				workspace,
				setWorkspace,
				clearWorkspace,
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
