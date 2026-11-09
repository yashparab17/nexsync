import { Field } from "@/components/ui/field";
import { useState, useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Check, RefreshCw, FolderOpen, Globe, Lock, Sparkles, UsersRound } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogTrigger, DialogHeading, DialogFooter } from "@/components/ui/dialog";

import { open } from "@tauri-apps/plugin-dialog";
import { documentDir } from "@tauri-apps/api/path";
import { createWorkspace, defaultDisplayName, importWorkspace, loadConfig } from "@/lib/tauri";
import { cleanPath, errorText } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P } from "@/store/p2p/P2PContext";
import { p2p } from "@/lib/p2p";

const LAST_FOLDER_KEY = "nexsync.join.lastFolder";

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
	const [userName, setUserName] = useState("");
	const [isProcessing, setIsProcessing] = useState(false);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isSuccess, setIsSuccess] = useState(false);
	const [touched, setTouched] = useState(false);
	const ticketMissing = touched && !ticket.trim();
	const folderMissing = touched && !workspaceParentPath.trim();

	// Prefill the name saved in Settings
	useEffect(() => {
		loadConfig()
			.then((c) => c.display_name || defaultDisplayName())
			.then(setUserName)
			.catch(() => {});
	}, []);

	// Default storage location to user Documents directory
	useEffect(() => {
		documentDir()
			.then((dir) => setWorkspaceParentPath(localStorage.getItem(LAST_FOLDER_KEY) || dir))
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
		if (!cleanTicket || !workspaceParentPath.trim()) {
			setTouched(true);
			return;
		}
		if (isProcessing) return;
		try {
			localStorage.setItem(LAST_FOLDER_KEY, workspaceParentPath.trim());
		} catch {
			// Remembering the folder is a convenience
		}

		try {
			setIsProcessing(true);
			setError(null);
			setStatusMessage("Connecting…");

			// 1. Dial the host and prove we hold its invite (or wait for it to allow our 6-digit code)
			const usingCode = p2p.isShortCode(cleanTicket);
			if (usingCode) setStatusMessage("Waiting for the host…");
			const { workspaceName, peerId } = await (usingCode ? joinWithCode : joinWithTicket)(
				cleanTicket,
				userName.trim() || "Collaborator",
			);

			setStatusMessage(`Connected to ${workspaceName}. Setting up…`);

			// 2. Determine target workspace path
			const sanitizedName = (workspaceName || "synced-workspace").replace(/[^\w\s-]/gi, "");
			const parentPath = workspaceParentPath.replace(/\\/g, "/");
			const targetPath = `${parentPath}/${sanitizedName}`;

			// 3. Create or import local workspace clone on disk (create_workspace appends the name itself)
			let wsInfo;
			try {
				wsInfo = await createWorkspace({
					name: sanitizedName,
					description: `Shared workspace`,
					path: parentPath,
				});
			} catch {
				// If directory already exists, import it
				wsInfo = await importWorkspace(targetPath);
			}

			await loadWorkspace(wsInfo);

			// Pull the host's workspace into the new local copy; files keep downloading after we navigate
			await requestWorkspaceSnapshot(peerId, wsInfo.path);

			setIsSuccess(true);
			setStatusMessage("Ready. Opening…");

			// 4. Navigate to dashboard
			setTimeout(() => {
				navigate("/workspace/dashboard");
			}, 600);
		} catch (err: unknown) {
			console.error("Join failed:", err);
			setError(errorText(err, "Couldn't join. Is the host online?"));
			setStatusMessage(null);
		} finally {
			setIsProcessing(false);
		}
	};

	return (
		<DialogTrigger>
			{children}

			<Dialog className="sm:max-w-md">
				<DialogHeading icon={<UsersRound className="size-6" />} title="Join with a Ticket" />

				<p className="flex items-center gap-2 text-sm text-muted-foreground">
					<Lock className="size-4 shrink-0 text-primary" />
					Encrypted end to end.
				</p>

				{error && <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

				<div className="flex flex-col gap-3">
					<Field label="Invite or code" htmlFor="join-ticket">
<Textarea id="join-ticket" placeholder="Invite or code" value={ticket} onChange={(e) => setTicket(e.target.value)} rows={3} className="font-mono text-xs break-all" autoFocus aria-invalid={ticketMissing || undefined} aria-describedby={ticketMissing ? "join-ticket-error" : undefined} />
{ticketMissing && <p id="join-ticket-error" className="mt-1 text-sm text-destructive">Paste the invite or 6-digit code from the host.</p>}
<Button variant="outline" size="sm" className="mt-2 self-start" onPress={() => void navigator.clipboard?.readText().then((text) => text && setTicket(text.trim()), () => {})}>Paste from clipboard</Button>
</Field>

					<Field label="Save in" htmlFor="join-folder">
<div className="flex gap-2">
							<Input id="join-folder" value={workspaceParentPath} onChange={(e) => setWorkspaceParentPath(e.target.value)} placeholder="Choose a folder" className="font-mono text-xs" aria-invalid={folderMissing || undefined} />
							<Button variant="outline" onPress={pickDestinationFolder}>
								<FolderOpen className="size-4" />
								Browse
							</Button>
						</div>
{folderMissing && <p className="mt-1 text-sm text-destructive">Choose a folder to save the workspace in.</p>}
</Field>

					<Field label="Your name" htmlFor="join-name">
<Input id="join-name" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Your name" />
</Field>
				</div>

				{statusMessage && (
					<div className="flex items-center gap-2 border border-info/30 bg-info/10 p-3 text-sm text-info">
						{isSuccess ? <Sparkles className="size-4 text-success" /> : <RefreshCw className="size-4 animate-spin" />}
						<span>{statusMessage}</span>
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" slot="close">Cancel</Button>
					<Button onPress={handleJoinWorkspace} isDisabled={isProcessing || isSuccess}>
						{isProcessing ? (
							<><RefreshCw className="size-4 animate-spin" />Connecting…</>
						) : isSuccess ? (
							<><Check className="size-4" />Connected</>
						) : (
							<><Globe className="size-4" />Join</>
						)}
					</Button>
				</DialogFooter>
			</Dialog>
		</DialogTrigger>
	);
}


