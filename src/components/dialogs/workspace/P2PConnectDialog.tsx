import { useEffect, useState } from "react";
import { AlertTriangle, Globe, KeyRound, Lock, Sparkles, Unplug, Users, Wifi } from "lucide-react";
import { Check, Copy, Radio, RefreshCw } from "@/components/animate-icons";

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
import { p2p, type InviteInfo, type ShortCodeInfo } from "@/lib/p2p";
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
		createShortCode,
		revokeInvite,
		joinWithTicket,
		joinWithCode,
		requestWorkspaceSnapshot,
		disconnectPeer,
		retryConnection,
		reconnectToHost,
		hostUnreachable,
		hostName,
		link,
		network,
	} = useP2P();

	const [activeTab, setActiveTab] = useState<"invite" | "join" | "peers">("invite");

	// Host flow state
	const [hostRole, setHostRole] = useState("Editor");
	// Limits for a full invite: how long it lasts (seconds, empty for until stopped) and whether one guest uses it up
	const [expiry, setExpiry] = useState("3600");
	const [singleUse, setSingleUse] = useState(false);
	const [invite, setInvite] = useState<InviteInfo | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [shortCode, setShortCode] = useState<ShortCodeInfo | null>(null);
	const [secondsLeft, setSecondsLeft] = useState(0);
	const { copiedKey, copy } = useCopyToClipboard();

	// Count down the short code and hide it once it expires
	useEffect(() => {
		if (!shortCode) return;
		const tick = () => {
			const left = Math.max(0, Math.round((shortCode.expiresAt - Date.now()) / 1000));
			setSecondsLeft(left);
			if (left === 0) setShortCode(null);
		};
		tick();
		const timer = setInterval(tick, 1000);
		return () => clearInterval(timer);
	}, [shortCode]);

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
			setInvite(await createInvite(hostRole, { expiresInSecs: expiry ? Number(expiry) : undefined, singleUse }));
		} catch (err) {
			setErrorMessage(errorText(err, "Failed to create an invite."));
		} finally {
			setIsGenerating(false);
		}
	};

	// A 6-digit code that lasts 2 minutes; the host must allow the guest when they use it
	const handleGenerateShortCode = async () => {
		try {
			setIsGenerating(true);
			setErrorMessage(null);
			setShortCode(await createShortCode(hostRole));
			setInvite(null);
		} catch (err) {
			setErrorMessage(errorText(err, "Failed to create a code."));
		} finally {
			setIsGenerating(false);
		}
	};

	// Re-dial the host by hand, e.g. after the network came back
	const handleRetry = async () => {
		setErrorMessage(null);
		try {
			await retryConnection();
		} catch (err) {
			// Nothing to re-dial since the app was opened: go back to the host this copy joined, as a member
			if (!(await reconnectToHost())) setErrorMessage(errorText(err, "Couldn't retry the connection."));
		}
	};

	const handleStopInviting = async () => {
		await revokeInvite().catch(() => {});
		setInvite(null);
		setShortCode(null);
	};

	// Join a host and pull its workspace into the one that's open
	const handleJoin = async () => {
		const ticket = ticketInput.trim();
		if (!ticket) return;

		try {
			setIsJoining(true);
			setErrorMessage(null);
			const joined = await (p2p.isShortCode(ticket) ? joinWithCode : joinWithTicket)(ticket);
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

	// "Online" means the internet and relay are reachable, whether or not a peer is connected
	const statusLabel = !network.online
		? "Offline"
		: peers.length > 0
		  ? hostName !== null && link === "members"
			? `Connected to ${peers.length === 1 ? "a member" : `${peers.length} members`} (${hostName} is offline)`
			: "Connected"
		  : connectionStatus === "reconnecting"
			? hostName ? `Reconnecting to ${hostName}…` : "Reconnecting"
			: connectionStatus === "connecting"
			  ? hostName ? `Reaching ${hostName}…` : "Connecting"
			  : hostUnreachable
				? `${hostName ?? "The host"} is offline`
				: "Online";
	const statusDot = !network.online
		? "bg-destructive"
		: peers.length > 0
		  ? "bg-success animate-ping"
		  : connectionStatus === "reconnecting" || connectionStatus === "connecting"
			? "bg-warning animate-pulse"
			: hostUnreachable
			  ? "bg-destructive"
			  : "bg-success";

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
						<div className="flex h-9 w-9 items-center justify-center rounded-none bg-info/10 text-info border border-info/20">
							<Radio className="h-5 w-5 animate-pulse" />
						</div>
						<div>
							<DialogTitle className="text-lg">
								Collaborate
							</DialogTitle>
							<DialogDescription className="text-xs">
								Invite someone to work on this workspace with you, from any network.
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>

					<div className="flex items-center gap-1.5 font-mono text-xs" role="status">
						<span className={cn("h-2 w-2 rounded-none", statusDot)} />
						<span>{statusLabel}</span>
					</div>

				{network.online && hostUnreachable && peers.length === 0 && (
					<div className="flex items-start gap-2 rounded-none border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
						<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<div className="space-y-1">
							<p>
								{hostName ?? "The host"} isn't online right now, or has closed Nexsync. This workspace is hosted from their device, so
								nobody else can connect you to it. Your copy keeps working, and this device looks for them again every 30 seconds.
							</p>
							<Button variant="outline" size="sm" className="mt-1 gap-1.5" onPress={handleRetry}>
								<RefreshCw className="h-3.5 w-3.5" />
								Try now
							</Button>
						</div>
					</div>
				)}

				{network.online && hostName !== null && link === "members" && (
					<div className="flex items-start gap-2 rounded-none border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
						<Radio className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<p>
							{hostName} is offline. You are working with the other members who are online, and your changes reach {hostName} when
							they are back. Settings, roles and invites can only be changed while the host is connected.
						</p>
					</div>
				)}

				{!network.online && (
					<div className="flex items-start gap-2 rounded-none border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
						<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<div className="space-y-1">
							<p>
								Nexsync can't reach the service that connects you to people on other networks.
								Check your internet, then press Retry.
							</p>
							{network.detail && <p className="font-mono text-xs opacity-80">Details: {network.detail}</p>}
							<p className="opacity-80">
								On a college or office network a firewall may be blocking it. Try a phone hotspot,
								a VPN, or ask IT to allow access to *.relay.n0.iroh.link.
							</p>
							<Button variant="outline" size="sm" className="mt-1 gap-1.5" onPress={handleRetry}>
								<RefreshCw className="h-3.5 w-3.5" />
								Retry connection
							</Button>
						</div>
					</div>
				)}

				{errorMessage && (
					<div className="rounded-none border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
						{errorMessage}
					</div>
				)}

				{syncProgress && (
					<div className="flex items-center gap-2 rounded-none border border-info/20 bg-info/10 px-3 py-2 text-xs text-info">
						<RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
						<span className="truncate">{describeSyncProgress(syncProgress)}</span>
					</div>
				)}

				{/* Tab Selection */}
				<div className="flex border-b border-border/50">
					<button type="button" onClick={() => setActiveTab("invite")} className={tabClass("invite")}>
						<Users className="h-3.5 w-3.5" />
						Invite someone
					</button>
					<button type="button" onClick={() => setActiveTab("join")} className={tabClass("join")}>
						<Globe className="h-3.5 w-3.5" />
						Join with Invite
					</button>
					<button type="button" onClick={() => setActiveTab("peers")} className={tabClass("peers")}>
						<Wifi className="h-3.5 w-3.5" />
						People ({peers.length})
					</button>
				</div>

				{/* TAB 1: HOST INVITE */}
				{activeTab === "invite" && (
					<div className="space-y-4 pt-1">
						<div className="space-y-2">
							<Label className="text-xs">What the person you invite can do</Label>
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

						{shortCode ? (
							<div className="space-y-3 rounded-none border bg-muted/30 p-4 text-center">
								<Label className="text-xs text-muted-foreground font-medium">
									Tell your collaborator this code:
								</Label>
								<div className="font-mono text-4xl font-bold tracking-[0.3em] text-primary select-all">
									{shortCode.code.slice(0, 3)} {shortCode.code.slice(3)}
								</div>
								<p className="text-xs text-muted-foreground">
									Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}.
									You will be asked to allow them when they use it.
								</p>
								{!shortCode.relayConnected && (
									<p className="text-xs text-warning">
										Couldn't reach the internet service that connects you to other networks, so only people on your local network can join.
									</p>
								)}
								<div className="flex justify-center gap-2">
									<Button size="sm" variant="secondary" onPress={() => copy(shortCode.code, "code")} className="h-8 px-3 text-xs gap-1.5">
										{copiedKey === "code" ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
										{copiedKey === "code" ? "Copied" : "Copy"}
									</Button>
									<Button size="sm" variant="ghost" onPress={handleStopInviting} className="h-8 text-xs text-muted-foreground hover:text-destructive">
										Cancel
									</Button>
								</div>
							</div>
						) : !invite ? (
							<div className="space-y-3">
							<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
								<label className="flex items-center gap-1.5">
									Full invite lasts
									<select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="h-7 border border-input bg-background px-1.5">
										<option value="600">10 minutes</option>
										<option value="3600">1 hour</option>
										<option value="86400">1 day</option>
										<option value="604800">7 days</option>
										<option value="">Until I stop it</option>
									</select>
								</label>
								<label className="flex items-center gap-1.5">
									<input type="checkbox" checked={singleUse} onChange={(e) => setSingleUse(e.target.checked)} />
									Only one person can use it
								</label>
							</div>
							<div className="flex gap-2">
								<Button
									onPress={handleGenerateShortCode}
									isDisabled={isGenerating}
									className="flex-1 h-9 text-xs gap-2"
								>
									{isGenerating ? (
										<>
											<RefreshCw className="h-3.5 w-3.5 animate-spin" />
											Connecting…
										</>
									) : (
										<>
											<KeyRound className="h-3.5 w-3.5" />
											6-digit Code
										</>
									)}
								</Button>
								<Button
									variant="outline"
									onPress={handleGenerateInvite}
									isDisabled={isGenerating}
									className="flex-1 h-9 text-xs gap-2"
								>
									<Copy className="h-3.5 w-3.5" />
									Full invite
								</Button>
							</div>
							</div>
						) : (
							<div className="space-y-3 rounded-none border bg-muted/30 p-4">
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
												<Check className="h-4 w-4 text-success" />
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
								<div className="max-h-28 overflow-y-auto rounded-none border border-primary/30 bg-background px-3 py-2 font-mono text-xs leading-relaxed break-all select-all text-primary">
									{invite.ticket}
								</div>
								<p className="text-xs text-muted-foreground">
									{invite.expiresAt ? `Works until ${new Date(invite.expiresAt).toLocaleString()}` : "Works until you stop it"}
									{invite.singleUse ? ", for one person." : "."}
								</p>

								{!invite.relayConnected && (
									<div className="flex items-start gap-2 rounded-none border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning">
										<AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
										<span>
											Couldn't reach the internet service that connects you to other networks, so only people on your local
											network can join. Check your internet connection and create a new invite.
										</span>
									</div>
								)}

								{/* Live rendezvous status */}
								<div className="rounded-none border border-border/50 bg-background/60 p-3 text-xs flex items-center justify-between">
									{hasGuests ? (
										<div className="flex items-center gap-2 text-success font-medium">
											<Check className="h-4 w-4" />
											<span>Collaborator connected. Your changes now show up for both of you.</span>
										</div>
									) : (
										<div className="flex items-center gap-2 text-muted-foreground">
											<RefreshCw className="h-3.5 w-3.5 animate-spin text-info" />
											<span>Waiting for a collaborator to join…</span>
										</div>
									)}
									<div className="flex items-center gap-1">
										<Button
											variant="ghost"
											size="sm"
											onPress={handleGenerateInvite}
											className="h-7 text-xs text-muted-foreground hover:text-foreground"
										>
											New Invite
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onPress={handleStopInviting}
											className="h-7 text-xs text-muted-foreground hover:text-destructive"
										>
											Stop
										</Button>
									</div>
								</div>
								<p className="text-xs text-muted-foreground">
									Making a new invite or pressing Stop turns this one off. People who
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
							<Label className="text-xs">Paste the invite or type the 6-digit code</Label>
							<Textarea
								placeholder="Paste the invite, or type the 6-digit code"
								value={ticketInput}
								onChange={(e) => setTicketInput(e.target.value)}
								rows={4}
								className="font-mono text-xs break-all rounded-none border border-input px-3 py-2"
								autoFocus
							/>
							<p className="text-xs text-muted-foreground">
								Their workspace will be copied into the workspace you have open and kept up to date.
							</p>
						</div>

						{joinSuccess ? (
							<div className="flex items-center justify-center gap-2 p-3 text-xs text-success font-medium">
								<Sparkles className="h-4 w-4" />
								<span>Connected! Getting the workspace…</span>
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
										Connecting…
									</>
								) : (
									<>
										<Globe className="h-3.5 w-3.5" />
										Join workspace
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
								<p className="text-xs font-medium">No one is connected</p>
								<p className="text-xs text-muted-foreground/70">
									Create an invite or paste one from a collaborator to connect.
								</p>
									<Button variant="outline" size="sm" className="mt-3 gap-1.5" onPress={handleRetry}>
										<RefreshCw className="h-3.5 w-3.5" />
										Reconnect to host
									</Button>
							</div>
						) : (
							<div className="space-y-3">
								<div className="flex items-center justify-between">
									<span className="text-xs text-muted-foreground">
										People connected ({peers.length})
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
											Refresh from host
										</Button>
									)}
								</div>

								<div className="space-y-2 max-h-[240px] overflow-y-auto">
									{peers.map((peer) => (
										<div
											key={peer.id}
											className="flex items-center justify-between rounded-none border bg-card p-2.5 text-xs"
										>
											<div className="flex items-center gap-2.5">
												<span className="h-2 w-2 rounded-none bg-success" />
												<div>
													<div className="flex items-center gap-1.5 font-medium">
														<span>{peer.name}</span>
														<span className="rounded-none bg-muted px-1.5 py-0.5 text-xs text-muted-foreground ">
															{peer.isHost ? "Host" : peer.role}
														</span>
														<span
															className={cn(
																"rounded-none px-1.5 py-0.5 text-xs ",
																peer.connectionType === "direct"
																	? "text-success"
																	: "text-warning",
															)}
															title={
																peer.connectionType === "relay"
																	? "Connected through a helper server because a direct link is not possible here. Still private. Nexsync keeps trying for a direct one."
																	: undefined
															}
														>
															{peer.connectionType === "direct"
																? "Direct"
																: peer.connectionType === "relay"
																	? "Indirect"
																	: "Connecting"}
														</span>
													</div>
													<div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
														<span>Delay: {peer.latencyMs} ms</span>
														<span>•</span>
														<span>
															Sent {(peer.bytesSent / 1024).toFixed(1)} KB · Received{" "}
															{(peer.bytesReceived / 1024).toFixed(1)} KB
														</span>
													</div>
												</div>
											</div>

											<div className="flex items-center gap-1.5">
												<div className="flex items-center gap-1 text-xs text-success py-0.5">
													<Lock className="h-3 w-3" />
													<span>Private</span>
												</div>
												<Button
													size="sm"
													variant="ghost"
													onPress={() => disconnectPeer(peer.id)}
													className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
													aria-label="Disconnect this person"
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
