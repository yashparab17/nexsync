// React
import { useEffect, useRef, useState, type ReactNode } from "react";

// React Router
import { useNavigate } from "react-router-dom";

// Icons
import { Folder, FolderOpen, FolderPlus } from "lucide-react";

// Components
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

// Tauri
import { open } from "@tauri-apps/plugin-dialog";
import { documentDir } from "@tauri-apps/api/path";
import { createWorkspace } from "@/lib/tauri";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

interface CreateWorkspaceDialogProps {
	children: ReactNode;
}

export default function CreateWorkspaceDialog({
	children,
}: CreateWorkspaceDialogProps) {
	const navigate = useNavigate();
	const { loadWorkspace } = useWorkspace();

	const [workspaceName, setWorkspaceName] = useState("");
	const [description, setDescription] = useState("");
	const [workspacePath, setWorkspacePath] = useState("");
	const [error, setError] = useState("");

	// Guards against double-submits without triggering a re-render,
	// so the button stays visually stable while the workspace is created.
	const isCreating = useRef(false);

	// Default the storage location to the user's Documents directory.
	useEffect(() => {
		documentDir()
			.then((dir) => setWorkspacePath(dir))
			.catch((err) => {
				console.error("Failed to resolve Documents directory:", err);
				setError(
					"Could not resolve your Documents folder. Please pick a location manually.",
				);
			});
	}, []);

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

	const handleCreateWorkspace = async () => {
		if (!workspaceName.trim() || isCreating.current) {
			return;
		}

		isCreating.current = true;
		setError("");

		try {
			const workspace = await createWorkspace({
				name: workspaceName,
				description,
				path: workspacePath,
			});

			// loadWorkspace handles:
			// - Loading full metadata into context
			// - Adding to recent workspaces registry
			// - Setting as last workspace for session restoration
			await loadWorkspace(workspace);

			navigate("/workspace");
		} catch (err) {
			console.error(err);
			setError(String(err));
		} finally {
			isCreating.current = false;
		}
	};

	const canCreate =
		workspaceName.trim().length > 0 && workspacePath.length > 0;

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
									autoComplete="off"
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
									autoComplete="off"
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
									className="border-0 pl-2"
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
							<div className="grid h-20 w-20 place-items-center rounded-xl bg-primary">
								<Folder className="size-8" />
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

				{error && <p className="text-sm text-destructive">{error}</p>}

				{/* Footer */}
				<DialogFooter>
					<Button
						variant="outline"
						slot="close"
						className="cursor-pointer hover:scale-[1.02] hover:border-primary"
					>
						Cancel
					</Button>

					<Button
						onPress={handleCreateWorkspace}
						isDisabled={!canCreate}
						className="cursor-pointer hover:scale-[1.02] hover:border-primary"
					>
						<FolderPlus className="mr-2 size-4" />
						Create Workspace
					</Button>
				</DialogFooter>
			</Dialog>
		</DialogTrigger>
	);
}
