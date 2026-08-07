// Context
import { useWorkspace } from "@/store/WorkspaceContext";

// Components
import WorkspaceSidebar from "@/components/layout/WorkspaceSidebar";
import WorkspaceHeader from "@/components/layout/WorkspaceHeader";

export default function Workspace() {
	const { workspace } = useWorkspace();

	if (!workspace) {
		return null;
	}

	return (
		<div className="flex h-screen bg-background">
			<WorkspaceSidebar />

			<div className="flex min-w-0 flex-1 flex-col">
				<WorkspaceHeader />

				<main className="flex-1 overflow-auto p-6">
					<h1 className="text-2xl font-semibold">
						Welcome to {workspace.name}
					</h1>

					<p className="mt-2 text-muted-foreground">
						{workspace.description || "No description provided."}
					</p>
				</main>
			</div>
		</div>
	);
}
