import { useState } from "react";
// React Router
import { useNavigate } from "react-router-dom";

// Icons
import { Lock, Radio, Settings } from "lucide-react";

// Components
import { Button } from "@/components/ui/button";
import WorkspaceSearch from "@/components/layout/workspace/WorkspaceSearch";
import { useP2P } from "@/store/p2p/P2PContext";
import P2PConnectDialog from "@/components/dialogs/workspace/P2PConnectDialog";
import { cn } from "@/lib/utils";

// Header component for the workspace layout
export default function WorkspaceHeader() {
	const navigate = useNavigate();
	const { peers, connectionStatus } = useP2P();
	const [isP2POpen, setIsP2POpen] = useState(false);

	const connectedCount = peers.filter((p) => p.status === "connected").length;

	return (
		<header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 lg:px-6">
			{/* Search */}
			<div className="flex min-w-0 flex-1 justify-center">
				<WorkspaceSearch />
			</div>

			{/* Right Actions: P2P Badge & Settings */}
			<div className="flex shrink-0 items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => setIsP2POpen(true)}
					className="h-8 gap-1.5 px-2.5 text-xs"
				>
					<span
						className={cn(
							"h-2 w-2 rounded-none",
							connectedCount > 0
								? "bg-emerald-400 animate-ping"
								: connectionStatus === "connecting"
									? "bg-amber-400 animate-pulse"
									: "bg-muted-foreground",
						)}
					/>
					<Radio className="h-3.5 w-3.5 text-sky-400" />
					<span className="hidden md:inline">
						{connectedCount > 0
							? `${connectedCount} Peer${connectedCount > 1 ? "s" : ""}`
							: "P2P Sync"}
					</span>
					<div className="hidden items-center gap-0.5 text-[10px] lg:flex text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded-none border border-emerald-500/20 ml-0.5">
						<Lock className="h-2.5 w-2.5" />
						<span>E2EE</span>
					</div>
				</Button>

				<Button
					variant="ghost"
					size="icon"
					onPress={() => navigate("/workspace/settings")}
					aria-label="Open workspace settings"
				>
					<Settings className="size-5" />
				</Button>
			</div>

			<P2PConnectDialog open={isP2POpen} onOpenChange={setIsP2POpen} />
		</header>
	);
}

