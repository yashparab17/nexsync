// React Router
import { Outlet, useNavigate } from "react-router-dom";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// Components
import WorkspaceSidebar from "@/components/layout/workspace/WorkspaceSidebar";
import WorkspaceHeader from "@/components/layout/workspace/WorkspaceHeader";
import JoinRequestDialog from "@/components/dialogs/workspace/JoinRequestDialog";
import WorkspaceDeletedDialog from "@/components/dialogs/workspace/WorkspaceDeletedDialog";
import HostHandoffDialog from "@/components/dialogs/workspace/HostHandoffDialog";

// Shell layout for all workspace sub-routes
export default function Workspace() {
	const { workspace, isLoading } = useWorkspace();
	const navigate = useNavigate();

	// Show loader while workspace data is being fetched
	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-muted-foreground">Loading workspace…</p>
			</div>
		);
	}

	// Defensive redirect to Welcome if no workspace is active
	if (!workspace) {
		if (window.location.pathname === "/workspace") {
			navigate("/", { replace: true });
		}
		return null;
	}

	return (
		<div className="flex h-full">
			{/* Sidebar */}
			<WorkspaceSidebar />

			{/* Main content area */}
			<div className="flex min-w-0 flex-1 flex-col">
				{/* Header */}
				<WorkspaceHeader />

				{/* Page content */}
				<main className="flex-1 overflow-auto p-6">
					<Outlet />
				</main>
			</div>

			{/* Guests joining with a short code wait here for the host to allow them */}
			<JoinRequestDialog />

			{/* Shown to guests when the host deletes the workspace */}
			<WorkspaceDeletedDialog />

			{/* Shown to a guest the host wants to hand hosting to */}
			<HostHandoffDialog />
		</div>
	);
}
