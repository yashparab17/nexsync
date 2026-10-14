import { lazy, Suspense, useEffect, useState } from "react";
// React Router
import { useSearchParams } from "react-router-dom";

// Icons
import { Radio, Settings, Menu } from "@/components/animate-icons";

// Components
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import WorkspaceSearch from "@/components/layout/workspace/WorkspaceSearch";
import NotificationBell from "@/components/layout/workspace/NotificationBell";
import CatchUp from "@/components/layout/workspace/CatchUp";
import PresenceStrip from "@/components/layout/workspace/PresenceStrip";
import { useP2P } from "@/store/p2p/P2PContext";
import P2PConnectDialog from "@/components/dialogs/workspace/P2PConnectDialog";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

const WorkspaceSettings = lazy(() => import("@/pages/workspace/WorkspaceSettings"));

// Header component for the workspace layout
export default function WorkspaceHeader({ onOpenMenu, menuOpen = false }: { onOpenMenu?: () => void; menuOpen?: boolean }) {
	const { peers, connectionStatus, network } = useP2P();
	const [isP2POpen, setIsP2POpen] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);

	// The palette opens the settings popup with ?settings=1
	const [params, setParams] = useSearchParams();
	const wantsSettings = params.has("settings");
	useEffect(() => {
		if (!wantsSettings) return;
		setIsSettingsOpen(true);
		setParams({}, { replace: true });
	}, [wantsSettings, setParams]);

	const connectedCount = peers.filter((p) => p.status === "connected").length;

	// How the connection is, as a small dot on the button: green when people are connected or the network is ready,
	// amber and pulsing while connecting, red when offline. The words are in the tooltip and the accessible name.
	const connecting = connectionStatus === "connecting" || connectionStatus === "reconnecting";
	const status = connectedCount > 0
		? { label: `Collaborate: ${connectedCount} ${connectedCount === 1 ? "person" : "people"} connected`, short: `${connectedCount} connected`, dot: "bg-success" }
		: !network.online
			? { label: "Collaborate: offline", short: "Offline", dot: "bg-destructive" }
			: connecting
				? { label: "Collaborate: connecting", short: "Connecting", dot: "bg-warning animate-pulse motion-reduce:animate-none" }
				: { label: "Collaborate: online, ready to invite", short: "Online", dot: "bg-success" };

	return (
		<header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
			{/* Opens the navigation drawer when the sidebar is hidden */}
			{onOpenMenu && (
				<Button variant="ghost" size="icon" onPress={onOpenMenu} aria-label={t("nav.open")} aria-expanded={menuOpen} className="md:hidden">
					<Menu className="size-5" />
				</Button>
			)}

			{/* Search */}
			<div className="flex min-w-0 flex-1 justify-end">
				<WorkspaceSearch />
			</div>

			{/* Right Actions: P2P Badge & Settings */}
			<div className="flex shrink-0 items-center gap-2">
				<PresenceStrip />
				<CatchUp />
					<NotificationBell />
				<span title={status.label} className="inline-flex">
					<Button variant="ghost" onPress={() => setIsP2POpen(true)} aria-label={status.label} className="gap-2 px-3" data-testid="connection-chip">
						<Radio className="size-5" />
						<span className={cn("size-2.5 shrink-0", status.dot)} aria-hidden />
						<span className="hidden text-sm lg:inline">{status.short}</span>
					</Button>
				</span>

				<Button
					variant="ghost"
					size="icon"
					onPress={() => setIsSettingsOpen(true)}
					aria-label="Open workspace settings"
				>
					<Settings className="size-5" />
				</Button>
			</div>

			<P2PConnectDialog open={isP2POpen} onOpenChange={setIsP2POpen} />

			{/* The popup asks before closing with unsaved edits, so Escape and a click outside are off */}
			<Dialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} showCloseButton={false} isDismissable={false} isKeyboardDismissDisabled className="overflow-hidden p-0 sm:max-w-5xl">
				{isSettingsOpen && (
					<Suspense fallback={<div className="h-[85vh]" />}>
						<WorkspaceSettings onClose={() => setIsSettingsOpen(false)} />
					</Suspense>
				)}
			</Dialog>
		</header>
	);
}

