import { useState, useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
	Check,
	FolderOpen,
	Globe,
	Lock,
	Radio,
	RefreshCw,
	ShieldCheck,
	Sparkles,
} from "lucide-react";

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

import { open } from "@tauri-apps/plugin-dialog";
import { documentDir } from "@tauri-apps/api/path";
import { createWorkspace, importWorkspace, loadConfig } from "@/lib/tauri";
import { errorText } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P } from "@/store/p2p/P2PContext";
import { p2p } from "@/lib/p2p";

interface JoinWorkspaceDialogProps {
	children: ReactNode;
}

export default function JoinWorkspaceDialog({
	children,
}: JoinWorkspaceDialogProps) {
	const navigate = useNavigate();
	const { loadWorkspace } = useWorkspace();
	const { joinWithTicket, joinWithCode, requestWorkspaceSnapshot } = useP2P();

	const [ticket, setTicket] = useState("");
	const [workspaceParentPath, setWorkspaceParentPath] = useState("");
	const [userName, setUserName] = useState("Collaborator");
	const [isProcessing, setIsProcessing] = useState(false);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isSuccess, setIsSuccess] = useState(false);

	// Prefill the name saved in Settings
	useEffect(() => {
		loadConfig()
			.then((c) => c.display_name && setUserName(c.display_name))
			.catch(() => {});
	}, []);

	// Default storage location to user Documents directory
	useEffect(() => {
		documentDir()
			.then((dir) => setWorkspaceParentPath(dir))
			.catch((err) => {
				console.error("Failed to resolve Documents directory:", err);
			});
	}, []);

	// Native directory picker
	const pickDestinationFolder = async () => {
		try {
			const selected = await open({
				directory: true,
				multiple: false,
				defaultPath: workspaceParentPath,
			});

			if (selected && typeof selected === "string") {
				setWorkspaceParentPath(selected);
			}
		} catch (err) {
			console.error("Folder picker error:", err);
		}
	};

	// Connect to the host, create a local copy of its workspace, then sync it
	const handleJoinWorkspace = async () => {
		const cleanTicket = ticket.trim();
		if (!cleanTicket || !workspaceParentPath.trim() || isProcessing) {
			return;
		}

		try {
			setIsProcessing(true);
			setError(null);
			setStatusMessage("Connecting…");

			// 1. Dial the host and prove we hold its invite (or wait for it to allow our 6-digit code)
			const usingCode = p2p.isShortCode(cleanTicket);
			if (usingCode) setStatusMessage("Waiting for the host to allow you…");
			const { workspaceName, peerId } = await (usingCode ? joinWithCode : joinWithTicket)(
				cleanTicket,
				userName.trim() || "Collaborator",
			);

			setStatusMessage(`Connected to ${workspaceName}! Setting up your copy…`);

			// 2. Determine target workspace path
			const sanitizedName = (workspaceName || "synced-workspace").replace(/[^\w\s-]/gi, "");
			const parentPath = workspaceParentPath.replace(/\\/g, "/");
			const targetPath = `${parentPath}/${sanitizedName}`;

			// 3. Create or import local workspace clone on disk (create_workspace appends the name itself)
			let wsInfo;
			try {
				wsInfo = await createWorkspace({
					name: sanitizedName,
					description: `Shared workspace from a collaborator`,
					path: parentPath,
				});
			} catch {
				// If directory already exists, import it
				wsInfo = await importWorkspace(targetPath);
			}

			await loadWorkspace(wsInfo as any);

			// Pull the host's workspace into the new local copy; files keep downloading after we navigate
			await requestWorkspaceSnapshot(peerId, wsInfo.path);

			setIsSuccess(true);
			setStatusMessage("Workspace ready! Opening…");

			// 4. Navigate to dashboard
			setTimeout(() => {
				navigate("/workspace/dashboard");
			}, 600);
		} catch (err: unknown) {
			console.error("Join workspace failed:", err);
			setError(errorText(err, "Couldn't join the workspace. Check that the host is online."));
			setStatusMessage(null);
		} finally {
			setIsProcessing(false);
		}
	};

	return (
		<DialogTrigger>
			{children}

			<Dialog className="sm:max-w-xl">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<div className="flex h-9 w-9 items-center justify-center rounded-none bg-sky-500/10 text-sky-400 border border-sky-500/20">
							<Radio className="h-5 w-5 animate-pulse" />
						</div>
						<div>
							<DialogTitle className="text-lg">Join a Workspace</DialogTitle>
							<DialogDescription className="text-xs">
								Paste the invite or code your collaborator shared to get a copy of their workspace that stays up to date.
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				{/* Security banner */}
				<div className="flex items-center justify-between rounded-none border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
					<div className="flex items-center gap-2">
						<ShieldCheck className="h-4 w-4" />
						<span>Private: only you and your collaborators can read your files</span>
					</div>
					<div className="flex items-center gap-1 font-mono text-[11px]">
						<Lock className="h-3 w-3" />
						<span>No cloud</span>
					</div>
				</div>

				{error && (
					<div className="rounded-none border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
						{error}
					</div>
				)}

				<div className="space-y-4 pt-1">
					{/* Invite ticket input */}
					<div className="space-y-1.5">
						<Label className="text-xs">Invite or 6-digit code *</Label>
						<Textarea
							placeholder="Paste the invite, or type the 6-digit code"
							value={ticket}
							onChange={(e) => setTicket(e.target.value)}
							rows={3}
							className="font-mono text-[11px] break-all rounded-none border border-input px-3 py-2"
							autoFocus
						/>
					</div>

					{/* Local Destination folder */}
					<div className="space-y-1.5">
						<Label className="text-xs">Save to folder</Label>
						<div className="flex items-center gap-2">
							<Input
								value={workspaceParentPath}
								onChange={(e) => setWorkspaceParentPath(e.target.value)}
								placeholder="Choose a folder to save the workspace in"
								className="text-xs h-9"
							/>
							<Button
								variant="outline"
								size="icon"
								onPress={pickDestinationFolder}
								aria-label="Pick location"
								className="h-9 w-9 shrink-0"
							>
								<FolderOpen className="size-4" />
							</Button>
						</div>
					</div>

					{/* Your Name */}
					<div className="space-y-1.5">
						<Label className="text-xs">Your Display Name</Label>
						<Input
							value={userName}
							onChange={(e) => setUserName(e.target.value)}
							placeholder="e.g. Alice"
							className="text-xs h-9"
						/>
					</div>

					{statusMessage && (
						<div className="flex items-center gap-2 rounded-none border border-sky-500/20 bg-sky-500/10 p-2.5 text-xs text-sky-400">
							{isSuccess ? (
								<Sparkles className="h-4 w-4 text-emerald-400" />
							) : (
								<RefreshCw className="h-4 w-4 animate-spin text-sky-400" />
							)}
							<span>{statusMessage}</span>
						</div>
					)}

					<DialogFooter>
						<Button
							onPress={handleJoinWorkspace}
							isDisabled={!ticket.trim() || !workspaceParentPath.trim() || isProcessing || isSuccess}
							className="w-full h-10 text-xs gap-2"
						>
							{isProcessing ? (
								<>
									<RefreshCw className="h-3.5 w-3.5 animate-spin" />
									Connecting…
								</>
							) : isSuccess ? (
								<>
									<Check className="h-3.5 w-3.5 text-emerald-400" />
									Connected!
								</>
							) : (
								<>
									<Globe className="h-3.5 w-3.5" />
									Connect & Join Workspace
								</>
							)}
						</Button>
					</DialogFooter>
				</div>
			</Dialog>
		</DialogTrigger>
	);
}


