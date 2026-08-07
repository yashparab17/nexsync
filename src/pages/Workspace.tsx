// React / React Router
import { useNavigate } from "react-router-dom";

// Components
import { Button } from "@/components/ui/button";

// Context
import { useWorkspace } from "@/store/WorkspaceContext";

export default function Workspace() {
	const { workspace } = useWorkspace();
	const navigate = useNavigate();

	if (!workspace) {
		return (
			<main className="flex min-h-screen items-center justify-center bg-background">
				<div className="text-center">
					<h1 className="text-2xl font-semibold">
						No Workspace Open
					</h1>

					<p className="mt-2 text-muted-foreground">
						Please create or import a workspace first.
					</p>

					<Button className="mt-6" onClick={() => navigate("/")}>
						Return to Welcome
					</Button>
				</div>
			</main>
		);
	}

	return (
		<main className="flex min-h-screen flex-col bg-background p-8">
			<h1 className="text-4xl font-bold">{workspace.name}</h1>

			<p className="mt-2 text-muted-foreground">
				{workspace.description || "No description provided."}
			</p>

			<div className="mt-8 rounded-lg border p-6">
				<h2 className="text-xl font-semibold">Workspace Loaded</h2>

				<p className="mt-2 text-sm text-muted-foreground">
					This workspace was successfully imported from the local
					filesystem.
				</p>

				<div className="mt-4 space-y-1 text-sm">
					<p>
						<strong>Name:</strong> {workspace.name}
					</p>

					<p>
						<strong>ID:</strong> {workspace.id}
					</p>

					<p>
						<strong>Created:</strong> {workspace.created_at}
					</p>
				</div>
			</div>
		</main>
	);
}
