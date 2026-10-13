// React
import { useState, type ReactNode } from "react";

// React Router
import { useNavigate } from "react-router-dom";

// Icons
import { FolderOpen, FolderUp } from "@/components/animate-icons";

// Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cleanPath } from "@/lib/utils";
import { Dialog, DialogTrigger, DialogHeading, DialogFooter } from "@/components/ui/dialog";

// Tauri API
import { open } from "@tauri-apps/plugin-dialog";
import { importWorkspace } from "@/lib/tauri";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

interface ImportWorkspaceDialogProps {
	children: ReactNode;
}

// Dialog modal for importing an existing Nexsync workspace from disk
export default function ImportWorkspaceDialog({
	children,
}: ImportWorkspaceDialogProps) {
	const navigate = useNavigate();
	const { loadWorkspace } = useWorkspace();

	const [workspacePath, setWorkspacePath] = useState("");
	const [error, setError] = useState("");

	// Open folder picker to choose existing workspace directory
	const pickWorkspace = async () => {
		setError("");

		const selected = await open({
			directory: true,
			multiple: false,
		});

		if (selected && typeof selected === "string") {
			setWorkspacePath(cleanPath(selected));
		}
	};

	// Import workspace from selected path and load into context
	const handleImportWorkspace = async () => {
		setError("");

		if (!workspacePath) {
			setError("Please select a workspace folder.");
			return;
		}

		try {
			const workspace = await importWorkspace(workspacePath);
			await loadWorkspace(workspace);
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
				<DialogHeading icon={<FolderUp className="size-6" />} title="Import a folder" description="Open a Nexsync workspace that is already on this computer, for example one you copied from another device." />

				<div className="flex flex-col gap-2">
					<Label htmlFor="workspace-path">Workspace folder</Label>
					<div className="flex gap-2">
						<Input id="workspace-path" readOnly placeholder="Choose a folder" value={workspacePath} className="font-mono text-xs" />
						<Button variant="outline" onPress={pickWorkspace}>
							<FolderOpen className="size-4" />
							Browse
						</Button>
					</div>
					{error && <p className="text-sm text-destructive">{error}</p>}
				</div>

				<DialogFooter>
					<Button variant="outline" slot="close">Cancel</Button>
					<Button onPress={handleImportWorkspace} isDisabled={!workspacePath}>
						<FolderUp className="size-4" />
						Import workspace
					</Button>
				</DialogFooter>
			</Dialog>
		</DialogTrigger>
	);
}
