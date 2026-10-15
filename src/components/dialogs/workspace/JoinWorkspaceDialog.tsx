import { useState, useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Check, RefreshCw, FolderOpen, Globe, Lock, Sparkles, UsersRound } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogTrigger, DialogHeading, DialogFooter } from "@/components/ui/dialog";

import { open } from "@tauri-apps/plugin-dialog";
import { documentDir } from "@tauri-apps/api/path";
import { createWorkspace, importWorkspace, loadConfig } from "@/lib/tauri";
import { cleanPath, errorText } from "@/lib/utils";
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
				setWorkspaceParentPath(cleanPath(selected));
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
				<DialogHeading icon={<UsersRound className="size-6" />} title="Join with a Ticket" />

				<p className="flex items-center gap-2 text-sm text-muted-foreground">
					<Lock className="size-4 shrink-0 text-primary" />
					The connection is end-to-end encrypted. No server sees your files.
				</p>

				{error && <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

				<div className="flex flex-col gap-5">
					<div className="flex flex-col gap-2">
						<Label htmlFor="join-ticket">Invite or 6-digit code</Label>
						<Textarea id="join-ticket" placeholder="Paste the invite, or type the 6-digit code" value={ticket} onChange={(e) => setTicket(e.target.value)} rows={3} className="font-mono text-xs break-all" autoFocus />
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor="join-folder">Save in</Label>
						<div className="flex gap-2">
							<Input id="join-folder" value={workspaceParentPath} onChange={(e) => setWorkspaceParentPath(e.target.value)} placeholder="Choose a folder" className="font-mono text-xs" />
							<Button variant="outline" onPress={pickDestinationFolder}>
								<FolderOpen className="size-4" />
								Browse
							</Button>
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor="join-name">Your name</Label>
						<Input id="join-name" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Alice" />
					</div>
				</div>

				{statusMessage && (
					<div className="flex items-center gap-2 border border-info/30 bg-info/10 p-3 text-sm text-info">
						{isSuccess ? <Sparkles className="size-4 text-success" /> : <RefreshCw className="size-4 animate-spin" />}
						<span>{statusMessage}</span>
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" slot="close">Cancel</Button>
					<Button onPress={handleJoinWorkspace} isDisabled={!ticket.trim() || !workspaceParentPath.trim() || isProcessing || isSuccess}>
						{isProcessing ? (
							<><RefreshCw className="size-4 animate-spin" />Connecting…</>
						) : isSuccess ? (
							<><Check className="size-4" />Connected</>
						) : (
							<><Globe className="size-4" />Join workspace</>
						)}
					</Button>
				</DialogFooter>
			</Dialog>
		</DialogTrigger>
	);
}


