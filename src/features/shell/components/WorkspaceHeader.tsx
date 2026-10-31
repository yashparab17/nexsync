import { lazy, Suspense, useEffect, useRef, useState } from "react";
// React Router
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createPortal } from "react-dom";
import { useNavigate, useNavigationType, useSearchParams } from "react-router-dom";

// Icons
import { Radio, Settings, Menu } from "@/components/animate-icons";

// Components
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import WorkspaceSearch from "@/features/shell/components/WorkspaceSearch";
import NotificationBell from "@/features/shell/components/NotificationBell";
import TalkButtons from "@/features/shell/components/TalkButtons";
import PresenceStrip from "@/features/shell/components/PresenceStrip";
import { useP2P } from "@/store/p2p/P2PContext";
import { connectionView, TONE_DOT } from "@/lib/p2p/connectionState";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

// Both dialogs load the first time they are opened
const P2PConnectDialog = lazy(() => import("@/components/dialogs/workspace/P2PConnectDialog"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));

// The workspace's controls, placed in the window bar through portals (see TitleBar): this renders no bar of its own
export default function WorkspaceHeader({ onOpenMenu, menuOpen = false }: { onOpenMenu?: () => void; menuOpen?: boolean }) {
	const { peers, connectionStatus, network, link, hostName, hostUnreachable, syncProgress } = useP2P();
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

	// Back and forward stay inside the workspace: the first page seen here is as far back as it goes (never the Welcome page),
	// and forward goes only as far as the pages already visited. React Router numbers each history entry in history.state.idx.
	const navType = useNavigationType();
	const idx: number = window.history.state?.idx ?? 0;
	const span = useRef({ first: idx, last: idx });
	if (idx < span.current.first) span.current.first = idx;
	span.current.last = navType === "PUSH" ? idx : Math.max(span.current.last, idx);
	const canBack = idx > span.current.first;
	const canForward = idx < span.current.last;

	// Alt+Left and Alt+Right go back and forward, as in a browser
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
			const el = e.target as HTMLElement;
			if (el.closest("input,textarea,select,[contenteditable='true'],.cm-editor")) return;
			e.preventDefault();
			if (e.key === "ArrowLeft" ? canBack : canForward) navigate(e.key === "ArrowLeft" ? -1 : 1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [navigate, canBack, canForward]);

	// The workspace has no bar of its own: what it needs sits in the window bar, which the app draws before any workspace
	const [slots, setSlots] = useState<{ left: HTMLElement | null; center: HTMLElement | null; right: HTMLElement | null }>({ left: null, center: null, right: null });
	useEffect(() => setSlots({ left: document.getElementById("titlebar-left"), center: document.getElementById("titlebar-center"), right: document.getElementById("titlebar-right") }), []);

	const connectedCount =peers.filter((p) => p.status === "connected").length;

	const status = connectionView({ online: network.online, status: connectionStatus, connected: connectedCount, link, hostName, hostUnreachable, syncing: syncProgress !== null });

	return (
		<>
			{/* Back and forward, after the app name in the window bar (and the menu button when the sidebar is a drawer) */}
			{slots.left &&
				createPortal(
					<>
						{onOpenMenu && (
							<Button variant="ghost" size="icon-sm" onPress={onOpenMenu} aria-label={t("nav.open")} aria-expanded={menuOpen} className="md:hidden">
								<Menu className="size-4" />
							</Button>
						)}
						<Button variant="ghost" size="icon-sm" onPress={() => navigate(-1)} isDisabled={!canBack} aria-label="Back" className="hidden sm:inline-flex">
							<ChevronLeft className="size-4" />
						</Button>
						<Button variant="ghost" size="icon-sm" onPress={() => navigate(1)} isDisabled={!canForward} aria-label="Forward" className="hidden sm:inline-flex">
							<ChevronRight className="size-4" />
						</Button>
					</>,
					slots.left,
				)}

			{slots.center && createPortal(<WorkspaceSearch />, slots.center)}

			{/* Who is here, what you missed, notices, the connection and the settings: the right of the window bar */}
			{slots.right &&
				createPortal(
					<>
						<PresenceStrip />
												<TalkButtons />
						<NotificationBell />
						<span title={status.title} className="inline-flex">
<Button
							variant="ghost"
							size={status.label ? "sm" : "icon-sm"}
							onPress={() => setIsP2POpen(true)}
							aria-label={`Collaborate. ${status.label ? `${status.label}. ` : ""}${status.title}`}
							className={cn("relative", status.label && "gap-2 px-2")}
							data-testid="connection-chip"
						>
							<Radio className="size-4" />
							{status.label ? (
								<span className="flex items-center gap-1.5 text-[13px]">
									<span className={cn("size-2 shrink-0", TONE_DOT[status.tone])} aria-hidden />
									{status.label}
								</span>
							) : (
								<span className={cn("absolute -top-0.5 -right-0.5 size-2", TONE_DOT[status.tone])} aria-hidden />
							)}
						</Button>
</span>
						<span title="Workspace settings" className="inline-flex">
<Button variant="ghost" size="icon-sm" onPress={() => setIsSettingsOpen(true)} aria-label="Workspace settings">
							<Settings className="size-4" />
						</Button>
</span>
					</>,
					slots.right,
				)}

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
		</>
	);
}
