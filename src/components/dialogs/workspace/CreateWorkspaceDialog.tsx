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
import { IconPicker, IconView } from "@/components/elements/WorkspaceIcon";
import { setIcon, type WorkspaceIcon } from "@/lib/workspaceIcon";
import { Dialog, DialogTrigger, DialogHeading, DialogFooter } from "@/components/ui/dialog";

// Tauri API
import { open } from "@tauri-apps/plugin-dialog";
import { documentDir } from "@tauri-apps/api/path";
import { createWorkspace } from "@/lib/tauri";
import { cleanPath } from "@/lib/utils";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

interface CreateWorkspaceDialogProps {
	children: ReactNode;
}

// The folder the workspace will be made in, written with the separator the chosen folder uses (E:\Work\name, not E:\Work/name)
export function previewPath(folder: string, name: string): string {
	const sep = folder.includes("\\") ? "\\" : "/";
	return `${folder.replace(/[\\/]+$/, "")}${sep}${name}`.replace(/[\\/]+/g, sep);
}

// Dialog modal for creating a new local workspace
export default function CreateWorkspaceDialog({
	children,
}: CreateWorkspaceDialogProps) {
	const navigate = useNavigate();
	const { loadWorkspace } = useWorkspace();

	const [workspaceName, setWorkspaceName] = useState("");
	const [description, setDescription] = useState("");
	const [pickIcon, setPickIcon] = useState(false);
	const [workspacePath, setWorkspacePath] = useState("");
	const [error, setError] = useState("");
	const [icon, setIconChoice] = useState<WorkspaceIcon | null>(null);

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
			setWorkspacePath(cleanPath(selected));
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

			if (icon) setIcon(workspace.id, icon);
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
			<Dialog className="sm:max-w-md">
					<DialogHeading icon={<FolderPlus className="size-6" />} title="Create a Workspace" />

					{/* The card as it will appear on the Welcome screen; its name, description and icon are edited right here */}
					<div className="flex min-w-0 flex-col gap-3 border border-primary bg-card p-4">
						<div className="flex min-w-0 items-center gap-3">
							<button type="button" aria-expanded={pickIcon} aria-label="Change the icon" title="Change the icon" onClick={() => setPickIcon(!pickIcon)} className="shrink-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring">
								<IconView icon={icon} name={workspaceName} className="size-12 text-2xl" />
							</button>
							<div className="flex min-w-0 flex-1 flex-col gap-1">
								<Label htmlFor="workspace-name" className="sr-only">Name</Label>
								<Input id="workspace-name" autoComplete="off" autoFocus placeholder="Workspace name" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} aria-invalid={!!nameProblem} aria-describedby={nameProblem ? "workspace-name-problem" : undefined} />
								<Label htmlFor="description" className="sr-only">Description</Label>
								<Input id="description" autoComplete="off" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
							</div>
						</div>
						{nameProblem && (
							<p id="workspace-name-problem" role="alert" className="text-xs text-destructive">
								{nameProblem}
							</p>
						)}
						{pickIcon && <IconPicker value={icon} onChange={setIconChoice} name={workspaceName} bare />}
						<span className="truncate font-mono text-xs text-muted-foreground">{previewPath(workspacePath, workspaceName.trim() || "…")}</span>
					</div>

					<div className="flex flex-col gap-1">
						<Label htmlFor="workspace-location">Save in</Label>
						<div className="flex gap-2">
							<Input id="workspace-location" readOnly value={workspacePath} className="font-mono text-xs" />
							<Button variant="outline" onPress={pickFolder} aria-label="Choose a folder">
								<FolderOpen className="size-4" />
								Browse
							</Button>
						</div>
					</div>

					{error && <p className="text-sm text-destructive">{error}</p>}

				<DialogFooter>
					<Button variant="outline" slot="close">Cancel</Button>
					<Button onPress={handleCreateWorkspace} isDisabled={!canCreate}>
						<FolderPlus className="size-4" />
						Create Workspace
					</Button>
				</DialogFooter>
			</Dialog>
		</DialogTrigger>
	);
}
