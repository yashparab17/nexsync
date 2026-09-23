import { useState } from "react";
import {
	AlertTriangle,
	Check,
	Copy,
	Globe,
	KeyRound,
	Lock,
	Radio,
	RefreshCw,
	ShieldCheck,
	Sparkles,
	Unplug,
	Users,
	Wifi,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useP2P, describeSyncProgress } from "@/store/p2p/P2PContext";
import type { InviteInfo } from "@/lib/p2p";
import { cn, errorText } from "@/lib/utils";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";

interface P2PConnectDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

// Dialog for hosting, joining and managing P2P collaboration sessions
export default function P2PConnectDialog({
	open,
	onOpenChange,
}: P2PConnectDialogProps) {
	const {
		peers,
		connectionStatus,
		syncProgress,
		createInvite,
		revokeInvite,
		joinWithTicket,
		requestWorkspaceSnapshot,
		disconnectPeer,
	} = useP2P();

	const [activeTab, setActiveTab] = useState<"invite" | "join" | "peers">("invite");

	// Host flow state
	const [hostRole, setHostRole] = useState("Editor");
	const [invite, setInvite] = useState<InviteInfo | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const { copiedKey, copy } = useCopyToClipboard();

	// Join flow state
	const [ticketInput, setTicketInput] = useState("");
	const [isJoining, setIsJoining] = useState(false);
	const [joinSuccess, setJoinSuccess] = useState(false);

	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const hasGuests = peers.some((p) => !p.isHost);
	const hasHost = peers.some((p) => p.isHost);

	// Mint a fresh invite ticket (invalidates any previous one)
	const handleGenerateInvite = async () => {
		try {
			setIsGenerating(true);
			setErrorMessage(null);
			setInvite(await createInvite(hostRole));
		} catch (err) {
			setErrorMessage(errorText(err, "Failed to create an invite."));
		} finally {
			setIsGenerating(false);
		}
	};

	const handleStopInviting = async () => {
		await revokeInvite().catch(() => {});
		setInvite(null);
	};

	// Join a host and pull its workspace into the one that's open
	const handleJoin = async () => {
		const ticket = ticketInput.trim();
		if (!ticket) return;

		try {
			setIsJoining(true);
			setErrorMessage(null);
			const joined = await joinWithTicket(ticket);
			await requestWorkspaceSnapshot(joined.peerId);
			setJoinSuccess(true);
			setTicketInput("");
			setTimeout(() => {
				setActiveTab("peers");
				setJoinSuccess(false);
			}, 1500);
		} catch (err) {
			setErrorMessage(errorText(err, "Couldn't connect. Check the invite and that the host is online."));
		} finally {
			setIsJoining(false);
		}
	};

	const tabClass = (tab: typeof activeTab) =>
		cn(
			"flex flex-1 items-center justify-center gap-2 border-b-2 py-2.5 text-xs font-medium transition-colors",
			activeTab === tab
				? "border-primary text-foreground"
				: "border-transparent text-muted-foreground hover:text-foreground",
		);

	return (
		<Dialog isOpen={open} onOpenChange={onOpenChange} className="max-w-xl">
			<div className="space-y-4">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
							<Radio className="h-5 w-5 animate-pulse" />
						</div>
						<div>
							<DialogTitle className="text-lg">
								P2P Real-Time Collaboration
							</DialogTitle>
							<DialogDescription className="text-xs">
								Share an invite with a collaborator to connect directly, from any network.
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				{/* Security & status banner */}
				<div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
					<div className="flex items-center gap-2">
						<ShieldCheck className="h-4 w-4" />
						<span>End-to-end encrypted (QUIC + TLS 1.3 via Iroh)</span>
					</div>
					<div className="flex items-center gap-1.5 font-mono text-[11px]">
						<span
							className={cn(
								"h-2 w-2 rounded-full",
								connectionStatus === "connected"
									? "bg-emerald-400 animate-ping"
									: connectionStatus === "connecting"
										? "bg-amber-400 animate-pulse"
										: "bg-muted-foreground",
							)}
						/>
						<span className="capitalize">{connectionStatus}</span>
					</div>
				</div>

				{errorMessage && (
					<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
						{errorMessage}
					</div>
				)}

				{syncProgress && (
					<div className="flex items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-400">
						<RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
						<span className="truncate">{describeSyncProgress(syncProgress)}</span>
					</div>
				)}

				{/* Tab Selection */}
				<div className="flex border-b border-border/50">
					<button type="button" onClick={() => setActiveTab("invite")} className={tabClass("invite")}>
						<Users className="h-3.5 w-3.5" />
						Host Workspace
					</button>
					<button type="button" onClick={() => setActiveTab("join")} className={tabClass("join")}>
						<Globe className="h-3.5 w-3.5" />
						Join with Invite
					</button>
					<button type="button" onClick={() => setActiveTab("peers")} className={tabClass("peers")}>
						<Wifi className="h-3.5 w-3.5" />
						Peers ({peers.length})
					</button>
				</div>

				{/* TAB 1: HOST INVITE */}
				{activeTab === "invite" && (
					<div className="space-y-4 pt-1">
						<div className="space-y-2">
							<Label className="text-xs">Collaborator Permission</Label>
							<div className="flex gap-2">
								{["Editor", "Viewer"].map((r) => (
									<Button
										key={r}
										variant={hostRole === r ? "default" : "outline"}
										size="sm"
										onPress={() => setHostRole(r)}
										className="h-8 text-xs"
									>
										{r}
									</Button>
								))}
							</div>
						</div>

						{!invite ? (
							<Button
								onPress={handleGenerateInvite}
								isDisabled={isGenerating}
								className="w-full h-9 text-xs gap-2"
							>
								{isGenerating ? (
									<>
										<RefreshCw className="h-3.5 w-3.5 animate-spin" />
										Connecting to the relay network…
									</>
								) : (
									<>
										<KeyRound className="h-3.5 w-3.5" />
										Create Invite
									</>
								)}
							</Button>
						) : (
							<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
								<div className="flex items-center justify-between">
									<Label className="text-xs text-muted-foreground font-medium">
										Send this invite to your collaborator:
									</Label>
									<Button
										size="sm"
										variant="secondary"
										onPress={() => copy(invite.ticket)}
										className="h-8 px-3 text-xs gap-1.5"
									>
										{copiedKey === "copied" ? (
											<>
												<Check className="h-4 w-4 text-emerald-400" />
												Copied
											</>
										) : (
											<>
												<Copy className="h-4 w-4" />
												Copy
											</>
										)}
									</Button>
								</div>
								<div className="max-h-28 overflow-y-auto rounded-md border border-primary/30 bg-background px-3 py-2 font-mono text-[11px] leading-relaxed break-all select-all text-primary">
									{invite.ticket}
								</div>

								{!invite.relayConnected && (
									<div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-400">
										<AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
										<span>
											Couldn't reach the relay network, so only collaborators on your local
											network can join. Check your internet connection and create a new invite.
										</span>
									</div>
								)}

								{/* Live rendezvous status */}
								<div className="rounded-md border border-border/50 bg-background/60 p-3 text-xs flex items-center justify-between">
									{hasGuests ? (
										<div className="flex items-center gap-2 text-emerald-400 font-medium">
											<Check className="h-4 w-4" />
											<span>Collaborator connected! Live sync active.</span>
										</div>
									) : (
										<div className="flex items-center gap-2 text-muted-foreground">
											<RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-400" />
											<span>Waiting for a collaborator to join…</span>
										</div>
									)}
									<div className="flex items-center gap-1">
										<Button
											variant="ghost"
											size="sm"
											onPress={handleGenerateInvite}
											className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
										>
											New Invite
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onPress={handleStopInviting}
											className="h-7 text-[11px] text-muted-foreground hover:text-destructive"
										>
											Stop
										</Button>
									</div>
								</div>
								<p className="text-[11px] text-muted-foreground">
									Creating a new invite or pressing Stop invalidates this one. Collaborators who
									already joined stay connected.
								</p>
							</div>
						)}
					</div>
				)}

				{/* TAB 2: JOIN WITH INVITE */}
				{activeTab === "join" && (
					<div className="space-y-4 pt-1">
						<div className="space-y-2">
							<Label className="text-xs">Paste the host's invite</Label>
							<Textarea
								placeholder="nexsync…"
								value={ticketInput}
								onChange={(e) => setTicketInput(e.target.value)}
								rows={4}
								className="font-mono text-[11px] break-all rounded-md border border-input px-3 py-2"
								autoFocus
							/>
							<p className="text-[11px] text-muted-foreground">
								The host's workspace will be synced into the workspace you have open.
							</p>
						</div>

						{joinSuccess ? (
							<div className="flex items-center justify-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-400 font-medium">
								<Sparkles className="h-4 w-4" />
								<span>Connected! Syncing workspace…</span>
							</div>
						) : (
							<Button
								onPress={handleJoin}
								isDisabled={!ticketInput.trim() || isJoining}
								className="w-full h-10 text-xs gap-2"
							>
								{isJoining ? (
									<>
										<RefreshCw className="h-3.5 w-3.5 animate-spin" />
										Connecting to Host…
									</>
								) : (
									<>
										<Globe className="h-3.5 w-3.5" />
										Connect to Workspace
									</>
								)}
							</Button>
						)}
					</div>
				)}

				{/* TAB 3: CONNECTED PEERS */}
				{activeTab === "peers" && (
					<div className="space-y-3 pt-1">
						{peers.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
								<Radio className="h-8 w-8 stroke-[1.25] text-muted-foreground/40 mb-2" />
								<p className="text-xs font-medium">No peers connected</p>
								<p className="text-[11px] text-muted-foreground/70">
									Create an invite or paste one from a collaborator to connect.
								</p>
							</div>
						) : (
							<div className="space-y-3">
								<div className="flex items-center justify-between">
									<span className="text-xs text-muted-foreground">
										Connected Peers ({peers.length})
									</span>
									{hasHost && (
										<Button
											size="sm"
											variant="outline"
											onPress={() => requestWorkspaceSnapshot()}
											isDisabled={syncProgress !== null}
											className="h-7 text-xs gap-1.5"
										>
											<RefreshCw className="h-3 w-3" />
											Pull from Host
										</Button>
									)}
								</div>

								<div className="space-y-2 max-h-[240px] overflow-y-auto">
									{peers.map((peer) => (
										<div
											key={peer.id}
											className="flex items-center justify-between rounded-lg border bg-card p-2.5 text-xs"
										>
											<div className="flex items-center gap-2.5">
												<span className="h-2 w-2 rounded-full bg-emerald-400" />
												<div>
													<div className="flex items-center gap-1.5 font-medium">
														<span>{peer.name}</span>
														<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wider">
															{peer.isHost ? "Host" : peer.role}
														</span>
														<span
															className={cn(
																"rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
																peer.connectionType === "direct"
																	? "bg-emerald-500/10 text-emerald-400"
																	: "bg-amber-500/10 text-amber-400",
															)}
															title={
																peer.connectionType === "relay"
																	? "Traffic goes through an encrypted Iroh relay; NexSync keeps trying to switch to a direct link."
																	: undefined
															}
														>
															{peer.connectionType === "direct"
																? "Direct"
																: peer.connectionType === "relay"
																	? "Relayed"
																	: "Connecting"}
														</span>
													</div>
													<div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
														<span>Ping: {peer.latencyMs}ms</span>
														<span>•</span>
														<span>
															Tx: {(peer.bytesSent / 1024).toFixed(1)} KB / Rx:{" "}
															{(peer.bytesReceived / 1024).toFixed(1)} KB
														</span>
													</div>
												</div>
											</div>

											<div className="flex items-center gap-1.5">
												<div className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
													<Lock className="h-3 w-3" />
													<span>E2EE</span>
												</div>
												<Button
													size="sm"
													variant="ghost"
													onPress={() => disconnectPeer(peer.id)}
													className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
													aria-label="Disconnect peer"
												>
													<Unplug className="h-3.5 w-3.5" />
												</Button>
											</div>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				)}
			</div>
		</Dialog>
	);
}
