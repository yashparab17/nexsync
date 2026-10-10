// Covers the workspace while it waits for its host, when the workspace requires the host to be online. A guest who
// cannot reach the host is told so and sent back to the Welcome page.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WifiOff } from "@/components/animate-icons";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// Long enough to read why, short enough not to feel stuck
const REDIRECT_SECONDS = 8;

export default function HostGate() {
	const { hostGate, hostName } = useP2P();
	const { clearWorkspace } = useWorkspace();
	const navigate = useNavigate();
	const [left, setLeft] = useState(REDIRECT_SECONDS);

	const leave = useCallback(async () => {
		await clearWorkspace();
		navigate("/");
	}, [clearWorkspace, navigate]);

	// Counts down only while the host is known to be away; if they come back the screen goes and the count starts over
	useEffect(() => {
		if (hostGate !== "offline") {
			setLeft(REDIRECT_SECONDS);
			return;
		}
		const timer = setInterval(() => setLeft((s) => s - 1), 1000);
		return () => clearInterval(timer);
	}, [hostGate]);

	useEffect(() => {
		if (hostGate === "offline" && left <= 0) void leave();
	}, [hostGate, left, leave]);

	if (hostGate === "ok") return null;
	const host = hostName ?? "The host";

	return (
		<div role="alertdialog" aria-modal="true" aria-labelledby="host-gate-title" className="fixed inset-0 z-50 flex items-center justify-center bg-background p-6">
			<div className="max-w-md space-y-4 text-center">
				{hostGate === "connecting" ? (
					<Loader2 className="mx-auto size-10 animate-spin text-muted-foreground" aria-hidden />
				) : (
					<WifiOff className="mx-auto size-10 text-warning" aria-hidden />
				)}
				<h1 id="host-gate-title" className="text-xl font-semibold">
					{hostGate === "connecting" ? `Connecting to ${host}…` : `${host} is offline`}
				</h1>
				<p className="text-sm text-muted-foreground">
					{hostGate === "connecting"
						? "This workspace can only be used while its host is online. Hold on while we reach them."
						: `This workspace can only be used while its host is online. Ask ${host} to open Nexsync, then open the workspace again.`}
				</p>
				{hostGate === "offline" && <p className="text-xs text-muted-foreground">Taking you back to the Welcome page in {Math.max(left, 0)}…</p>}
				<Button variant="outline" onPress={() => void leave()}>
					Back to Welcome
				</Button>
			</div>
		</div>
	);
}
