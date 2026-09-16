import { useState } from "react";
import {
	Check,
	Copy,
	Globe,
	KeyRound,
	Lock,
	Radio,
	RefreshCw,
	ShieldCheck,
	Unplug,
	Users,
	Wifi,
	Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useP2P } from "@/store/p2p/P2PContext";
import { cn } from "@/lib/utils";

interface P2PConnectDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export default function P2PConnectDialog({
	open,
	onOpenChange,
}: P2PConnectDialogProps) {
	const {
		peers,
		connectionStatus,
		createShortCodeInvite,
		joinWithShortCode,
		requestWorkspaceSnapshot,
		disconnectPeer,
	} = useP2P();

	const [activeTab, setActiveTab] = useState<"invite" | "join" | "peers">("invite");

	// Host flow state
	const [hostRole, setHostRole] = useState("Editor");
	const [generatedShortCode, setGeneratedShortCode] = useState<string | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [copiedCode, setCopiedCode] = useState(false);

	// Join flow state
	const [joinCodeInput, setJoinCodeInput] = useState("");
	const [isJoining, setIsJoining] = useState(false);
	const [joinSuccess, setJoinSuccess] = useState(false);

	// Error state
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	// Generate Host 1-Step Short Code
	const handleGenerateCode = async () => {
		try {
			setIsGenerating(true);
			setErrorMessage(null);
			const { shortCode } = await createShortCodeInvite(hostRole);
			setGeneratedShortCode(shortCode);
		} catch (err: unknown) {
			setErrorMessage(err instanceof Error ? err.message : "Failed to generate invite code.");
		} finally {
			setIsGenerating(false);
		}
	};

	// Join directly with 1-Step Short Code
	const handleJoinWithCode = async () => {
		const cleanCode = joinCodeInput.trim().toUpperCase();
		if (!cleanCode) return;

		try {
			setIsJoining(true);
			setErrorMessage(null);
			await joinWithShortCode(cleanCode);
			setJoinSuccess(true);
			setTimeout(() => {
				setActiveTab("peers");
				setJoinSuccess(false);
			}, 1500);
		} catch (err: unknown) {
			setErrorMessage(err instanceof Error ? err.message : "Failed to connect. Make sure code is correct and host is online.");
		} finally {
			setIsJoining(false);
		}
	};

	const handleCopy = (text: string) => {
		navigator.clipboard.writeText(text);
		setCopiedCode(true);
		setTimeout(() => setCopiedCode(false), 2000);
	};

	const hasConnectedPeer = peers.some((p) => p.status === "connected");

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
								Connect directly with collaborators using a single 1-step room code.
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				{/* Security & status banner */}
				<div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
					<div className="flex items-center gap-2">
						<ShieldCheck className="h-4 w-4" />
						<span>End-to-End Encrypted (AES-256-GCM + X25519)</span>
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

				{/* Tab Selection */}
				<div className="flex border-b border-border/50">
					<button
						type="button"
						onClick={() => setActiveTab("invite")}
						className={cn(
							"flex flex-1 items-center justify-center gap-2 border-b-2 py-2.5 text-xs font-medium transition-colors",
							activeTab === "invite"
								? "border-primary text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						<Users className="h-3.5 w-3.5" />
						Host Workspace
					</button>
					<button
						type="button"
						onClick={() => setActiveTab("join")}
						className={cn(
							"flex flex-1 items-center justify-center gap-2 border-b-2 py-2.5 text-xs font-medium transition-colors",
							activeTab === "join"
								? "border-primary text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						<Globe className="h-3.5 w-3.5" />
						Join with Code
					</button>
					<button
						type="button"
						onClick={() => setActiveTab("peers")}
						className={cn(
							"flex flex-1 items-center justify-center gap-2 border-b-2 py-2.5 text-xs font-medium transition-colors",
							activeTab === "peers"
								? "border-primary text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
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

						{!generatedShortCode ? (
							<Button
								onPress={handleGenerateCode}
								isDisabled={isGenerating}
								className="w-full h-9 text-xs gap-2"
							>
								{isGenerating ? (
									<>
										<RefreshCw className="h-3.5 w-3.5 animate-spin" />
										Generating Pairing Code…
									</>
								) : (
									<>
										<KeyRound className="h-3.5 w-3.5" />
										Generate 1-Step Pairing Code
									</>
								)}
							</Button>
						) : (
							<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
								<div className="flex flex-col items-center justify-center space-y-2 py-2">
									<Label className="text-xs text-muted-foreground font-medium">
										Share this code with your collaborator:
									</Label>
									<div className="flex items-center gap-3">
										<span className="font-mono text-3xl font-extrabold tracking-wider bg-background px-4 py-1.5 rounded-lg border border-primary/30 shadow-inner text-primary">
											{generatedShortCode}
										</span>
										<Button
											size="sm"
											variant="secondary"
											onPress={() => handleCopy(generatedShortCode)}
											className="h-10 px-3 text-xs gap-1.5"
										>
											{copiedCode ? (
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
								</div>

								{/* Live rendezvous status */}
								<div className="rounded-md border border-border/50 bg-background/60 p-3 text-xs flex items-center justify-between">
									<div className="flex items-center gap-2">
										{hasConnectedPeer ? (
											<div className="flex items-center gap-2 text-emerald-400 font-medium">
												<Check className="h-4 w-4" />
												<span>Collaborator connected! Live sync active.</span>
											</div>
										) : (
											<div className="flex items-center gap-2 text-muted-foreground">
												<RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-400" />
												<span>Waiting for collaborator to enter code…</span>
											</div>
										)}
									</div>
									<Button
										variant="ghost"
										size="sm"
										onPress={handleGenerateCode}
										className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
									>
										New Code
									</Button>
								</div>
							</div>
						)}
					</div>
				)}

				{/* TAB 2: JOIN WITH CODE */}
				{activeTab === "join" && (
					<div className="space-y-4 pt-1">
						<div className="space-y-2">
							<Label className="text-xs">Enter Host's Pairing Code</Label>
							<Input
								placeholder="e.g. NX-4821"
								value={joinCodeInput}
								onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
								className="font-mono text-center text-lg tracking-wider font-semibold h-11"
								autoFocus
							/>
						</div>

						{joinSuccess ? (
							<div className="flex items-center justify-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-400 font-medium">
								<Sparkles className="h-4 w-4" />
								<span>Connected successfully! Syncing workspace…</span>
							</div>
						) : (
							<Button
								onPress={handleJoinWithCode}
								isDisabled={!joinCodeInput.trim() || isJoining}
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
									Generate a pairing code or enter a code from a collaborator to connect.
								</p>
							</div>
						) : (
							<div className="space-y-3">
								<div className="flex items-center justify-between">
									<span className="text-xs text-muted-foreground">
										Active Mesh Connections ({peers.length})
									</span>
									<Button
										size="sm"
										variant="outline"
										onPress={() => requestWorkspaceSnapshot()}
										className="h-7 text-xs gap-1.5"
									>
										<RefreshCw className="h-3 w-3" />
										Sync All Workspace Data
									</Button>
								</div>

								<div className="space-y-2 max-h-[240px] overflow-y-auto">
									{peers.map((peer) => (
										<div
											key={peer.id}
											className="flex items-center justify-between rounded-lg border bg-card p-2.5 text-xs"
										>
											<div className="flex items-center gap-2.5">
												<span
													className={cn(
														"h-2 w-2 rounded-full",
														peer.status === "connected"
															? "bg-emerald-400"
															: "bg-amber-400 animate-pulse",
													)}
												/>
												<div>
													<div className="flex items-center gap-1.5 font-medium">
														<span>{peer.name}</span>
														<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wider">
															{peer.role}
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

