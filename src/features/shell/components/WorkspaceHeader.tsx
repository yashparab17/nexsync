import { lazy, Suspense, useEffect, useState } from "react";
// React Router
import { PanelTopClose } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

// Icons
import { ChevronLeft, ChevronRight, Radio, Settings, Menu } from "@/components/animate-icons";
import { bottomNavigation, navigation } from "@/features/shell/components/WorkspaceSidebar";

// Components
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import WorkspaceSearch from "@/features/shell/components/WorkspaceSearch";
import NotificationBell from "@/features/shell/components/NotificationBell";
import CatchUp from "@/features/shell/components/CatchUp";
import PresenceStrip from "@/features/shell/components/PresenceStrip";
import { useP2P } from "@/store/p2p/P2PContext";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

// Both dialogs load the first time they are opened
const P2PConnectDialog = lazy(() => import("@/components/dialogs/workspace/P2PConnectDialog"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));

// Header component for the workspace layout
export default function WorkspaceHeader({ onOpenMenu, menuOpen = false, onHide }: { onOpenMenu?: () => void; menuOpen?: boolean; onHide?: () => void }) {
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

	const navigate = useNavigate();
	const { pathname } = useLocation();
	const here = navigation.find((n) => (n.end ? pathname === n.path : pathname === n.path || pathname.startsWith(`${n.path}/`))) ?? bottomNavigation.find((n) => pathname.startsWith(n.path));
	const openFile = params.get("open");
	// Alt+Left and Alt+Right go back and forward, as in a browser
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
			const el = e.target as HTMLElement;
			if (el.closest("input,textarea,select,[contenteditable='true'],.cm-editor")) return;
			e.preventDefault();
			navigate(e.key === "ArrowLeft" ? -1 : 1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [navigate]);

	const connectedCount =peers.filter((p) => p.status === "connected").length;

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

			{/* Back, forward and where you are */}
			<div className="flex min-w-0 items-center gap-1">
				<Button variant="ghost" size="icon" onPress={() => navigate(-1)} aria-label="Back" className="hidden sm:inline-flex">
					<ChevronLeft className="size-5" />
				</Button>
				<Button variant="ghost" size="icon" onPress={() => navigate(1)} aria-label="Forward" className="hidden sm:inline-flex">
					<ChevronRight className="size-5" />
				</Button>
				<nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
					<span className="shrink-0 font-medium">{here ? t(here.label) : ""}</span>
					{openFile && (
						<>
							<span aria-hidden className="text-muted-foreground">/</span>
							<span className="truncate text-muted-foreground" title={openFile}>{openFile.split("/").pop()}</span>
						</>
					)}
				</nav>
			</div>

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

				{onHide && (
					<Button variant="ghost" size="icon" onPress={onHide} aria-label="Hide the headers">
						<PanelTopClose className="size-5" />
					</Button>
				)}

				<Button
					variant="ghost"
					size="icon"
					onPress={() => setIsSettingsOpen(true)}
					aria-label="Open workspace settings"
				>
					<Settings className="size-5" />
				</Button>
			</div>

			{isP2POpen && (
				<Suspense fallback={null}>
					<P2PConnectDialog open onOpenChange={setIsP2POpen} />
				</Suspense>
			)}

			{/* The popup asks before closing with unsaved edits, so Escape and a click outside are off */}
			<Dialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} showCloseButton={false} isDismissable={false} isKeyboardDismissDisabled className="overflow-hidden p-0 sm:max-w-5xl">
				{isSettingsOpen && (
					<Suspense fallback={<div className="h-[85vh]" />}>
						<SettingsPage onClose={() => setIsSettingsOpen(false)} />
					</Suspense>
				)}
			</Dialog>
		</header>
	);
}

