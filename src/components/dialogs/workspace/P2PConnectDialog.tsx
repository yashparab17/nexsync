import { useEffect, useState } from "react";
import { Check, Copy, Radio, RefreshCw, AlertTriangle, Globe, KeyRound, Link2, Lock, Sparkles, Unplug, Users } from "@/components/animate-icons";
import Avatar from "@/components/elements/Avatar";

import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
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
	const [showOptions, setShowOptions] = useState(false);
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

	const tabs = [
		{ id: "invite" as const, label: "Invite", icon: <Users className="size-4" /> },
		{ id: "join" as const, label: "Join", icon: <Globe className="size-4" /> },
		{ id: "peers" as const, label: `People${peers.length ? ` · ${peers.length}` : ""}`, icon: <Radio className="size-4" /> },
	];

	const roles = [
		{ id: "Editor", title: "Can edit", text: "Edits files, notes and tasks." },
		{ id: "Commenter", title: "Can comment", text: "Reads and comments only." },
		{ id: "Viewer", title: "Can view", text: "Reads only." },
	];

	// A notice above the tabs; the tone says how serious it is
	const notice = (tone: "warning" | "info" | "error", children: React.ReactNode) => (
		<div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-3 border px-3 py-3 text-sm", tone === "warning" ? "border-warning/40 bg-warning/10" : tone === "info" ? "border-info/40 bg-info/10" : "border-destructive/40 bg-destructive/10 text-destructive")}>
			<AlertTriangle className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : tone === "info" ? "text-info" : "text-destructive")} />
			<div className="min-w-0 flex-1 space-y-2">{children}</div>
		</div>
	);

	return (
		<Dialog isOpen={open} onOpenChange={onOpenChange} className="max-w-2xl">
			<div className="min-w-0 space-y-5">
				<DialogHeading icon={<Radio className="size-6" />} title="Collaborate" />

				{network.online && hostUnreachable && peers.length === 0 &&
					notice(
						"warning",
						<>
							<p>
								{hostName ?? "The host"} is offline. Your copy keeps working, and this device checks again every 30 seconds.
							</p>
							<Button variant="outline" size="sm" onPress={handleRetry}>
								<RefreshCw data-icon="inline-start" className="size-3.5" />
								Try Now
							</Button>
						</>,
					)}

				{network.online && hostName !== null && link === "members" &&
					notice("info", <p>{hostName} is offline. You are working with the online members, and {hostName} gets your changes later. Settings, roles and invites need the host.</p>)}

				{!network.online &&
					notice(
						"warning",
						<>
							<p>Can't reach the service that connects other networks. Check your internet.</p>
							{network.detail && <p className="font-mono text-xs opacity-80">Details: {network.detail}</p>}
							<p className="text-muted-foreground">On a college or office network, try a hotspot or VPN, or ask IT to allow *.relay.n0.iroh.link.</p>
							<Button variant="outline" size="sm" onPress={handleRetry}>
								<RefreshCw data-icon="inline-start" className="size-3.5" />
								Retry Connection
							</Button>
						</>,
					)}

				{errorMessage && notice("error", <p>{errorMessage}</p>)}

				{syncProgress && (
					<div role="status" className="flex items-center gap-2 border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">
						<RefreshCw className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
						<span className="min-w-0 truncate">{describeSyncProgress(syncProgress)}</span>
					</div>
				)}

				{/* Tabs */}
				<div role="tablist" aria-label="Collaborate" className="flex border-b">
					{tabs.map((tab) => (
						<button
							key={tab.id}
							type="button"
							role="tab"
							aria-selected={activeTab === tab.id}
							onClick={() => setActiveTab(tab.id)}
							className={cn(
								"flex flex-1 items-center justify-center gap-2 border-b-2 py-3 text-sm font-medium outline-none transition-colors focus-visible:bg-muted",
								activeTab === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
							)}
						>
							{tab.icon}
							{tab.label}
						</button>
					))}
				</div>

				{/* INVITE */}
				{activeTab === "invite" && (
					<div className="space-y-5">
						{!shortCode && !invite && (
							<>
								<fieldset className="space-y-2">
									<legend className="text-sm font-medium">1. What can they do?</legend>
									<div role="radiogroup" aria-label="What the person you invite can do" className="grid gap-2 sm:grid-cols-2">
										{roles.map((r) => (
											<button
												key={r.id}
												type="button"
												role="radio"
												aria-checked={hostRole === r.id}
												onClick={() => setHostRole(r.id)}
												className={cn("flex flex-col items-start gap-0.5 border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", hostRole === r.id ? "border-primary bg-primary/10" : "hover:bg-muted/50")}
											>
												<span className="flex items-center gap-2 text-sm font-semibold">
													<span className={cn("flex size-4 items-center justify-center border", hostRole === r.id ? "border-primary bg-primary text-primary-foreground" : "border-input")}>{hostRole === r.id && <Check className="size-3" />}</span>
													{r.title}
												</span>
												<span className="pl-6 text-sm text-muted-foreground">{r.text}</span>
											</button>
										))}
									</div>
								</fieldset>

								<fieldset className="space-y-2">
									<legend className="text-sm font-medium">2. How do they join?</legend>
									<div className="grid gap-2 sm:grid-cols-2">
										<button type="button" onClick={handleGenerateShortCode} disabled={isGenerating} className="flex flex-col items-start gap-1 border p-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
											<span className="flex items-center gap-2 text-sm font-semibold">
												{isGenerating ? <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" /> : <KeyRound className="size-4 text-primary" />}
												6-digit code
											</span>
											<span className="text-sm text-muted-foreground">Quickest. Works for 2 minutes; you approve each person.</span>
										</button>
										<button type="button" onClick={handleGenerateInvite} disabled={isGenerating} className="flex flex-col items-start gap-1 border p-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
											<span className="flex items-center gap-2 text-sm font-semibold">
												<Link2 className="size-4 text-primary" />
												Invite link
											</span>
											<span className="text-sm text-muted-foreground">A long invite to paste. Works until it expires or you stop it.</span>
										</button>
									</div>
									<button type="button" aria-expanded={showOptions} onClick={() => setShowOptions((o) => !o)} className="text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:text-foreground">
										{showOptions ? "Hide options for the invite link" : "Options for the invite link"}
									</button>
									{showOptions && (
										<div className="flex flex-wrap items-center gap-x-5 gap-y-2 border bg-muted/30 p-3 text-sm">
											<label className="flex items-center gap-2">
												Lasts
												<select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="h-8 border border-input bg-input px-2">
													<option value="600">10 minutes</option>
													<option value="3600">1 hour</option>
													<option value="86400">1 day</option>
													<option value="604800">7 days</option>
													<option value="">Until I stop it</option>
												</select>
											</label>
											<label className="flex items-center gap-2">
												<input type="checkbox" checked={singleUse} onChange={(e) => setSingleUse(e.target.checked)} />
												Only one person can use it
											</label>
										</div>
									)}
								</fieldset>
							</>
						)}

						{shortCode && (
							<div className="space-y-4 border bg-muted/40 p-5 text-center">
								<p className="text-sm text-muted-foreground">Share this code</p>
								<div className="text-5xl tabular-nums font-bold tracking-[0.25em] text-primary select-all" aria-label={`Code ${shortCode.code.split("").join(" ")}`}>
									{shortCode.code.slice(0, 3)} {shortCode.code.slice(3)}
								</div>
								<p className="text-sm text-muted-foreground" aria-live="off">
									Valid for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}. You approve each person.
								</p>
								{!shortCode.relayConnected && <p className="text-sm text-warning">Only people on your network can join: the connecting service is out of reach.</p>}
								<div className="flex justify-center gap-2">
									<Button variant="secondary" onPress={() => copy(shortCode.code, "code")}>
										{copiedKey === "code" ? <Check data-icon="inline-start" className="size-4 text-success" /> : <Copy data-icon="inline-start" className="size-4" />}
										{copiedKey === "code" ? "Copied" : "Copy Code"}
									</Button>
									<Button variant="ghost" onPress={handleStopInviting}>
										Cancel
									</Button>
								</div>
							</div>
						)}

						{invite && (
							<div className="space-y-4 border bg-muted/40 p-5">
								<div className="flex items-center justify-between gap-3">
									<p className="text-sm text-muted-foreground">Send this invite</p>
									<Button variant="secondary" size="sm" onPress={() => copy(invite.ticket)}>
										{copiedKey === "copied" ? <Check data-icon="inline-start" className="size-4 text-success" /> : <Copy data-icon="inline-start" className="size-4" />}
										{copiedKey === "copied" ? "Copied" : "Copy Invite"}
									</Button>
								</div>
								<div className="max-h-28 overflow-y-auto border border-primary/30 bg-background px-3 py-2 font-mono text-xs leading-relaxed break-all select-all text-primary">{invite.ticket}</div>
								<p className="text-sm text-muted-foreground">
									{invite.expiresAt ? `Works until ${new Date(invite.expiresAt).toLocaleString()}` : "Works until you stop it"}
									{invite.singleUse ? ", for one person." : "."}
								</p>
								{!invite.relayConnected && notice("warning", <p>Only people on your network can join. Check your internet, then make a new invite.</p>)}
								<div className="flex items-center justify-between gap-3 border-t pt-4">
									{hasGuests ? (
										<span className="flex items-center gap-2 text-sm font-medium text-success">
											<Check className="size-4" />
											Someone joined. Your changes now show up for both of you.
										</span>
									) : (
										<span className="flex items-center gap-2 text-sm text-muted-foreground">
											<RefreshCw className="size-4 animate-spin text-info motion-reduce:animate-none" />
											Waiting for someone to join…
										</span>
									)}
									<span className="flex shrink-0 gap-1">
										<Button variant="ghost" size="sm" onPress={handleGenerateInvite}>
											New Invite
										</Button>
										<Button variant="ghost" size="sm" onPress={handleStopInviting} className="hover:text-destructive">
											Stop
										</Button>
									</span>
								</div>
								<p className="text-sm text-muted-foreground">A new invite or Stop turns this one off. People already in stay connected.</p>
							</div>
						)}
					</div>
				)}

				{/* JOIN */}
				{activeTab === "join" && (
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="invite-ticket" className="text-sm">
								Paste the invite, or type the 6-digit code
							</Label>
							<Textarea
								id="invite-ticket"
								placeholder="123 456, or a long invite"
								value={ticketInput}
								onChange={(e) => setTicketInput(e.target.value)}
								rows={4}
								className="rounded-md border border-input px-3 py-2 font-mono text-xs break-all"
								autoFocus
							/>
							<p className="text-sm text-muted-foreground">Their workspace is copied into this one.</p>
						</div>
						{joinSuccess ? (
							<div role="status" className="flex items-center justify-center gap-2 p-3 text-sm font-medium text-success">
								<Sparkles className="size-4" />
								Connected! Getting the workspace…
							</div>
						) : (
							<Button onPress={handleJoin} isDisabled={!ticketInput.trim() || isJoining} className="w-full">
								{isJoining ? <RefreshCw data-icon="inline-start" className="size-4 animate-spin motion-reduce:animate-none" /> : <Globe data-icon="inline-start" className="size-4" />}
								{isJoining ? "Connecting…" : "Join Workspace"}
							</Button>
						)}
					</div>
				)}

				{/* PEOPLE */}
				{activeTab === "peers" && (
					<div className="space-y-3">
						{peers.length === 0 ? (
							<div className="flex flex-col items-center gap-2 py-8 text-center">
								<Radio className="size-8 text-muted-foreground/50" />
								<p className="text-sm font-medium">No one is connected</p>
								<p className="text-sm text-muted-foreground">Invite someone, or join with an invite.</p>
								<div className="mt-2 flex gap-2">
									<Button size="sm" onPress={() => setActiveTab("invite")}>
										Invite Someone
									</Button>
									<Button variant="outline" size="sm" onPress={handleRetry}>
										<RefreshCw data-icon="inline-start" className="size-3.5" />
										Reconnect to Host
									</Button>
								</div>
							</div>
						) : (
							<>
								{hasHost && (
									<div className="flex justify-end">
										<Button size="sm" variant="outline" onPress={() => requestWorkspaceSnapshot()} isDisabled={syncProgress !== null}>
											<RefreshCw data-icon="inline-start" className="size-3.5" />
											Refresh from Host
										</Button>
									</div>
								)}
								<ul className="max-h-72 space-y-2 overflow-y-auto" aria-label="People connected">
									{peers.map((peer) => (
										<li key={peer.id} className="flex items-center gap-3 border bg-muted/40 p-3">
											<Avatar name={peer.name} className="size-9" />
											<div className="min-w-0 flex-1">
												<div className="flex flex-wrap items-center gap-2">
													<span className="truncate text-sm font-medium">{peer.name}</span>
													<span className="bg-muted px-2 py-0.5 text-xs text-muted-foreground">{peer.isHost ? "Host" : peer.role}</span>
													<span
														className={cn("text-xs", peer.connectionType === "direct" ? "text-success" : "text-warning")}
														title={peer.connectionType === "relay" ? "Through a relay: no direct link yet. Still private." : undefined}
													>
														{peer.connectionType === "direct" ? "Direct" : peer.connectionType === "relay" ? "Indirect" : "Connecting"}
													</span>
												</div>
												<p className="truncate font-mono text-xs text-muted-foreground">
													{peer.latencyMs} ms · sent {(peer.bytesSent / 1024).toFixed(1)} KB · received {(peer.bytesReceived / 1024).toFixed(1)} KB
												</p>
											</div>
											<span className="hidden items-center gap-1 text-xs text-success sm:flex">
												<Lock className="size-3.5" />
												Private
											</span>
											<Button size="icon-xs" variant="ghost" onPress={() => disconnectPeer(peer.id)} className="size-8 hover:text-destructive" aria-label={`Disconnect ${peer.name}`}>
												<Unplug className="size-4" />
											</Button>
										</li>
									))}
								</ul>
							</>
						)}
					</div>
				)}
			</div>
		</Dialog>
	);
}
