// React
import { useState, type ReactNode } from "react";

// ShadCN UI Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	Dialog,
	DialogTrigger,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from "@/components/ui/dialog";

// Lucide Icons
import { Folder, FolderOpen, FolderPlus } from "lucide-react";

// Folder Picker (Tauri)
import { open } from "@tauri-apps/plugin-dialog";

interface CreateWorkspaceDialogProps {
	children: ReactNode;
}

export default function CreateWorkspaceDialog({
	children,
}: CreateWorkspaceDialogProps) {
	const [workspaceName, setWorkspaceName] = useState("");
	const [description, setDescription] = useState("");
	const [workspacePath, setWorkspacePath] = useState(
		"C:\\Users\\User\\Documents\\Nexsync",
	);

	const pickFolder = async () => {
		const selected = await open({
			directory: true,
			multiple: false,
			defaultPath: workspacePath,
		});

		if (selected && typeof selected === "string") {
			setWorkspacePath(selected);
		}
	};

	const handleCreateWorkspace = () => {
		if (!workspaceName.trim()) {
			alert("Please enter a workspace name.");
			return;
		}

		console.log({
			workspaceName,
			description,
			workspacePath,
		});

		// Later:
		// invoke("create_workspace", {...})
	};

	return (
		<DialogTrigger>
			{children}

			{/* Dialog */}
			<Dialog className="sm:max-w-2xl">
				{/* Header */}
				<DialogHeader>
					<DialogTitle>Create Workspace</DialogTitle>

					<DialogDescription>
						Create a new local-first workspace for your projects.
					</DialogDescription>
				</DialogHeader>

				{/* Body */}
				<div className="grid gap-8 py-4 md:grid-cols-[2fr_1fr]">
					{/* Left Column */}
					<div className="space-y-6">
						<div className="space-y-2">
							<Label htmlFor="workspace-name">
								Workspace Name
							</Label>

							<div className="border">
								<Input
									id="workspace-name"
									placeholder="e.g. MSc Research"
									className="pl-2"
									value={workspaceName}
									onChange={(e) =>
										setWorkspaceName(e.target.value)
									}
								/>
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">Description</Label>

							<div className="border">
								<Textarea
									id="description"
									placeholder="Optional description..."
									className="pl-2"
									value={description}
									onChange={(e) =>
										setDescription(e.target.value)
									}
								/>
							</div>
						</div>

						<div className="space-y-2">
							<Label>Storage Location</Label>

							<div className="flex gap-2 border">
								<Input
									readOnly
									value={workspacePath}
									className="pl-2"
								/>
								<Button variant="outline" onPress={pickFolder}>
									<FolderOpen className="size-4" />
								</Button>
							</div>
						</div>
					</div>

					{/* Right Column */}
					<div className="border bg-muted/40 p-4">
						<h3 className="mb-4 font-semibold">
							Workspace Preview
						</h3>

						<div className="flex flex-col items-center gap-4">
							<div className="flex h-20 w-20 items-center justify-center rounded-xl bg-primary text-5xl">
								<Folder className="size-8"></Folder>
							</div>

							<div className="text-center">
								<p className="font-medium">
									{workspaceName || "Workspace Name"}
								</p>

								<p className="text-sm text-muted-foreground">
									{description || "Local Workspace"}
								</p>
							</div>
						</div>
					</div>
				</div>

				{/* Footer */}
				<DialogFooter>
					<Button
						variant="outline"
						slot="close"
						className="cursor-pointer transition-all hover:scale-[1.02] hover:border-primary"
					>
						Cancel
					</Button>

					<Button
						onPress={handleCreateWorkspace}
						className="cursor-pointer transition-all hover:scale-[1.02] hover:border-primary"
					>
						<FolderPlus className="mr-2 size-4" />
						Create Workspace
					</Button>
				</DialogFooter>
			</Dialog>
		</DialogTrigger>
	);
}
