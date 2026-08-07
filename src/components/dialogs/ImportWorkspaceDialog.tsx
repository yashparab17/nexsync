import { ReactNode, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

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

import { FolderOpen, FolderUp } from "lucide-react";

interface ImportWorkspaceDialogProps {
	children: ReactNode;
}

export default function ImportWorkspaceDialog({
	children,
}: ImportWorkspaceDialogProps) {
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
			const workspace = await invoke("import_workspace", {
				path: workspacePath,
			});

			console.log("Workspace imported:", workspace);
		} catch (error) {
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
