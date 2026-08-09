// React Router
import { Outlet } from "react-router-dom";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// Components
import WorkspaceSidebar from "@/components/layout/workspace/WorkspaceSidebar";
import WorkspaceHeader from "@/components/layout/workspace/WorkspaceHeader";

export default function Workspace() {
	const { workspace, isLoading, error, clearError } = useWorkspace();

	if (isLoading) {
		return (
			<div className="flex h-screen items-center justify-center">
				<p className="text-muted-foreground">Loading workspace…</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-center">
					<p className="text-destructive">{error}</p>
					<button
						className="mt-2 text-sm underline"
						onClick={clearError}
					>
						Dismiss
					</button>
				</div>
			</div>
		);
	}

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
