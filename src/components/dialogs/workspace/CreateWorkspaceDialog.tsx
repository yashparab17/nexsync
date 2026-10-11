// React
import { validateWorkspaceName } from "@/lib/validation";
import { useEffect, useRef, useState, type ReactNode } from "react";

// React Router
import { useNavigate } from "react-router-dom";

// Icons
import { FolderOpen, FolderPlus } from "@/components/animate-icons";

// Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogTrigger, DialogHeading, DialogFooter } from "@/components/ui/dialog";

// Tauri API
import { open } from "@tauri-apps/plugin-dialog";
import { documentDir } from "@tauri-apps/api/path";
import { createWorkspace } from "@/lib/tauri";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

interface CreateWorkspaceDialogProps {
	children: ReactNode;
}

// Dialog modal for creating a new local workspace
export default function CreateWorkspaceDialog({
	children,
}: CreateWorkspaceDialogProps) {
	const navigate = useNavigate();
	const { loadWorkspace } = useWorkspace();

	const [workspaceName, setWorkspaceName] = useState("");
	const [description, setDescription] = useState("");
	const [workspacePath, setWorkspacePath] = useState("");
	const [error, setError] = useState("");

	// Guard against duplicate submissions
	const isCreating = useRef(false);

	// Default storage location to user Documents directory
	useEffect(() => {
		documentDir()
			.then((dir) => setWorkspacePath(dir ?? ""))
			.catch((err) => {
				console.error("Failed to resolve Documents directory:", err);
				setError(
					"Could not resolve your Documents folder. Please pick a location manually.",
				);
			});
	}, []);

	// Native directory picker dialog
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

	// Create workspace on disk and load into context
	const handleCreateWorkspace = async () => {
		if (!workspaceName.trim() || validateWorkspaceName(workspaceName) || isCreating.current) {
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

			await loadWorkspace(workspace);
			navigate("/workspace");
		} catch (err) {
			console.error(err);
			setError(String(err));
		} finally {
			isCreating.current = false;
		}
	};

	const nameProblem = validateWorkspaceName(workspaceName);
	const canCreate =
		workspaceName.trim().length > 0 && workspacePath.length > 0 && !nameProblem;

	return (
		<DialogTrigger>
			{children}

			{/* Dialog */}
			<Dialog className="sm:max-w-3xl">
				<DialogHeading icon={<FolderPlus className="size-6" />} title="Create a workspace" description="A workspace is a folder on this computer. Notes, tasks and code live in it as plain files." />

				<div className="grid gap-8 md:grid-cols-[3fr_2fr]">
					<div className="flex flex-col gap-5">
						<div className="flex flex-col gap-2">
							<Label htmlFor="workspace-name">Name</Label>
							<Input id="workspace-name" autoComplete="off" autoFocus placeholder="MSc research" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} aria-invalid={!!nameProblem} aria-describedby={nameProblem ? "workspace-name-problem" : undefined} />
							{nameProblem && (
								<p id="workspace-name-problem" role="alert" className="text-xs text-destructive">
									{nameProblem}
								</p>
							)}
						</div>

						<div className="flex flex-col gap-2">
							<Label htmlFor="description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
							<Textarea id="description" autoComplete="off" placeholder="What is this workspace for?" value={description} onChange={(e) => setDescription(e.target.value)} />
						</div>

						<div className="flex flex-col gap-2">
							<Label htmlFor="workspace-location">Save in</Label>
							<div className="flex gap-2">
								<Input id="workspace-location" readOnly value={workspacePath} className="font-mono text-xs" />
								<Button variant="outline" onPress={pickFolder} aria-label="Choose a folder">
									<FolderOpen className="size-4" />
									Browse
								</Button>
							</div>
						</div>
					</div>

					{/* The card as it will appear on the Welcome screen */}
					<div className="flex flex-col gap-3">
						<span className="font-mono text-sm text-muted-foreground">preview</span>
						<div className="flex min-h-44 flex-col gap-3 border border-primary bg-card p-6">
							<span className="text-xl font-semibold">{workspaceName.trim() || "Workspace name"}</span>
							<span className="line-clamp-2 text-muted-foreground">{description.trim() || "No description yet."}</span>
							<span className="mt-auto truncate font-mono text-xs text-muted-foreground">{workspacePath.replace(/[\\/]+$/, "")}/{workspaceName.trim() || "…"}</span>
						</div>
					</div>
				</div>

				{error && <p className="text-sm text-destructive">{error}</p>}

				<DialogFooter>
					<Button variant="outline" slot="close">Cancel</Button>
					<Button onPress={handleCreateWorkspace} isDisabled={!canCreate}>
						<FolderPlus className="size-4" />
						Create workspace
					</Button>
				</DialogFooter>
			</Dialog>
		</DialogTrigger>
	);
}
