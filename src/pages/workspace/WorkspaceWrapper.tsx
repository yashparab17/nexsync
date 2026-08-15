// React Router
import { Outlet } from "react-router-dom";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// Components
import WorkspaceSidebar from "@/components/layout/workspace/WorkspaceSidebar";
import WorkspaceHeader from "@/components/layout/workspace/WorkspaceHeader";

export default function Workspace() {
	const { workspace, isLoading } = useWorkspace();

	if (isLoading) {
		return (
			<div className="flex h-screen items-center justify-center">
				<p className="text-muted-foreground">Loading workspace…</p>
			</div>
		);
	}

	// Errors are surfaced by the global <ErrorDialog /> in App.tsx.
	if (!workspace) {
		return null;
	}

	return (
		<div className="flex h-screen">
			{/* Sidebar */}
			<WorkspaceSidebar />

			{/* Main area */}
			<div className="flex min-w-0 flex-1 flex-col">
				{/* Header */}
				<WorkspaceHeader />

				{/* Page content */}
				<main className="flex-1 overflow-auto p-6">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
