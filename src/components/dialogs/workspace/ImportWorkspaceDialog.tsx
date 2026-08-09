// React
import { useState, type ReactNode } from "react";

// React Router
import { useNavigate } from "react-router-dom";

// Icons
import { FolderOpen, FolderUp } from "lucide-react";

// Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
	Dialog,
	DialogTrigger,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from "@/components/ui/dialog";

// Tauri
import { open } from "@tauri-apps/plugin-dialog";
import { importWorkspace, addRecentWorkspace } from "@/lib/tauri";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

interface ImportWorkspaceDialogProps {
	children: ReactNode;
}

export default function ImportWorkspaceDialog({
	children,
}: ImportWorkspaceDialogProps) {
	const navigate = useNavigate();
	const { loadWorkspace } = useWorkspace();

	const [workspacePath, setWorkspacePath] = useState("");
	const [error, setError] = useState("");

	const pickWorkspace = async () => {
		setError("");

		const selected = await open({
			directory: true,
			multiple: false,
		});

		if (selected && typeof selected === "string") {
			setWorkspacePath(selected);
		}
	};

	const handleImportWorkspace = async () => {
		setError("");

		if (!workspacePath) {
			setError("Please select a workspace folder.");
			return;
		}

		try {
			const workspace = await importWorkspace(workspacePath);

			// Register in the app-level recent-workspaces list.
			await addRecentWorkspace(workspace);

			// Load full metadata into context, then navigate.
			await loadWorkspace(workspace.path);

			navigate("/workspace");
		} catch (error) {
			console.error("Failed to import workspace:", error);
			setError(String(error));
		}
	};

	return (
		<DialogTrigger>
			{children}

			<Dialog className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Import Workspace</DialogTitle>

					<DialogDescription>
						Open an existing Nexsync workspace from your computer.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4">
					<div className="space-y-2">
						<Label htmlFor="workspace-path">Workspace Folder</Label>

						<div className="flex gap-2 border">
							<Input
								id="workspace-path"
								readOnly
								placeholder="Choose a Nexsync workspace..."
								value={workspacePath}
								className="border-0 pl-2"
							/>

							<Button variant="outline" onPress={pickWorkspace}>
								<FolderOpen className="size-4" />
								Browse
							</Button>
						</div>
					</div>

					{error && (
						<p className="text-sm text-destructive">{error}</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" slot="close">
						Cancel
					</Button>

					<Button
						onPress={handleImportWorkspace}
						isDisabled={!workspacePath}
					>
						<FolderUp className="mr-2 size-4" />
						Import Workspace
					</Button>
				</DialogFooter>
			</Dialog>
		</DialogTrigger>
	);
}
