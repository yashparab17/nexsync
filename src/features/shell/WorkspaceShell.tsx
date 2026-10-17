// React Router
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

// Context
import { useCollapsed } from "@/hooks/useCollapsed";
import { PanelLeftOpen, PanelTopOpen } from "lucide-react";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P } from "@/store/p2p/P2PContext";
import { pageOf } from "@/lib/p2p/presence";

// Components
import { t } from "@/i18n";
import WorkspaceSidebar from "@/features/shell/components/WorkspaceSidebar";
import WorkspaceHeader from "@/features/shell/components/WorkspaceHeader";
import JoinRequestDialog from "@/components/dialogs/workspace/JoinRequestDialog";
import WorkspaceDeletedDialog from "@/components/dialogs/workspace/WorkspaceDeletedDialog";
import HostHandoffDialog from "@/components/dialogs/workspace/HostHandoffDialog";
import TransferTray from "@/features/shell/components/TransferTray";
import HostGate from "@/features/shell/components/HostGate";
import DueReminders from "@/features/shell/components/DueReminders";
import DependencyWatch from "@/features/shell/components/DependencyWatch";
import TestWatch from "@/features/shell/components/TestWatch";
import FollowWatch from "@/features/shell/components/FollowWatch";
import ShortcutsDialog from "@/components/dialogs/workspace/ShortcutsDialog";
import { shortcutFor } from "@/lib/shortcuts";
import { ChatProvider } from "@/store/chat/ChatContext";
import { ModerationExecutor, RejoinWatch, TimeoutBanner } from "@/features/moderation/components/ModerationRuntime";
import AnnouncementRuntime from "@/features/announcements/components/AnnouncementRuntime";
import ReviewBanner from "@/features/moderation/components/ReviewBanner";

// Shell layout for all workspace sub-routes
export default function Workspace() {
	const { workspace, isLoading } = useWorkspace();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	// The Editor, Notes, Files and Assets are full-bleed workspaces: no page padding, and they fill the window
	// Below the medium breakpoint the sidebar is a drawer
	const [navOpen, setNavOpen] = useState(false);
	// Both can be folded away for room to work: the sidebar (Ctrl+\) and the headers (Ctrl+Shift+H), kept on this device
	const [sidebarHidden, toggleSidebar] = useCollapsed("chrome.sidebar");
	const [headersHidden, toggleHeaders] = useCollapsed("chrome.headers");
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === "\\") {
				e.preventDefault();
				toggleSidebar();
			} else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "h") {
				e.preventDefault();
				toggleHeaders();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [toggleSidebar, toggleHeaders]);

	// Collaborators see which page this device is on
	const { setMyPresence } = useP2P();
	useEffect(() => {
		const page = pageOf(pathname);
		if (page) setMyPresence({ page });
	}, [pathname, setMyPresence]);

	useEffect(() => {
		if (!navOpen) return;
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [navOpen]);

	// Workspace-wide shortcuts; the Editor and Notes handle their own keys
	const [help, setHelp] = useState(false);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const action = shortcutFor(e);
			if (!action) return;
			e.preventDefault();
			if (action.type === "go") navigate(action.to);
			else if (action.type === "help") setHelp((h) => !h);
			else if (action.type === "settings") navigate(`${pathname}?settings=1`);
			else document.querySelector<HTMLInputElement>('input[aria-label="Search workspace"]')?.focus();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [navigate, pathname]);

	// Show loader while workspace data is being fetched
	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-muted-foreground">Loading workspace…</p>
			</div>
		);
	}

	// Defensive redirect to Welcome if no workspace is active
	if (!workspace) {
		if (window.location.pathname === "/workspace") {
			navigate("/", { replace: true });
		}
		return null;
	}

	return (
		<ChatProvider>
		<div className="flex h-full">
			{/* Sidebar */}
			{!sidebarHidden && (
				<div className="hidden h-full md:block">
					<WorkspaceSidebar />
				</div>
			)}

			{/* Drawer version of the sidebar for narrow windows */}
			{navOpen && (
				<div className="fixed inset-0 z-40 flex md:hidden">
					<div className="relative h-full animate-in slide-in-from-left duration-200 motion-reduce:animate-none">
						<WorkspaceSidebar expanded onNavigate={() => setNavOpen(false)} />
					</div>
					<button type="button" aria-label={t("nav.close")} className="flex-1 cursor-default bg-scrim" onClick={() => setNavOpen(false)} />
				</div>
			)}

			{/* Main content area */}
			<div data-hide-toolbars={headersHidden ? "" : undefined} className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background window-edge">
				{sidebarHidden && (
					<button type="button" aria-label="Show the sidebar" title="Show the sidebar (Ctrl+\)" onClick={toggleSidebar} className="absolute top-1/2 left-0 z-30 hidden h-10 w-4 -translate-y-1/2 items-center justify-center rounded-r-sm border border-l-0 bg-background text-muted-foreground opacity-60 shadow-sm outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring md:flex">
						<PanelLeftOpen className="size-3" />
					</button>
				)}
				{headersHidden && (
					<button type="button" aria-label="Show the headers" title="Show the headers (Ctrl+Shift+H)" onClick={toggleHeaders} className="absolute top-0 right-3 z-30 flex h-4 w-10 items-center justify-center rounded-b-sm border border-t-0 bg-background text-muted-foreground opacity-60 shadow-sm outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring">
						<PanelTopOpen className="size-3" />
					</button>
				)}
				{/* Header */}
				{!headersHidden && <WorkspaceHeader onOpenMenu={() => setNavOpen(true)} menuOpen={navOpen} onHide={toggleHeaders} />}
				<TimeoutBanner />
				<ReviewBanner />
				<AnnouncementRuntime />

				{/* Page content */}
				<div className="min-h-0 flex-1 overflow-hidden">
					<div key={pathname} className="relative flex h-full w-full flex-col animate-in fade-in duration-200 motion-reduce:animate-none">
						<Outlet />
					</div>
				</div>
			</div>

			{help && <ShortcutsDialog onClose={() => setHelp(false)} />}

			{/* Takes people off the member list when an Admin kicked or the Owner banned them */}
			<ModerationExecutor />
			<RejoinWatch />

			{/* Warns about work due today or late, whichever page is open */}
			<DueReminders />
			<DependencyWatch />
			<TestWatch />
			<FollowWatch />

			{/* Guests joining with a short code wait here for the host to allow them */}
			<JoinRequestDialog />

			{/* Shown to guests when the host deletes the workspace */}
			<WorkspaceDeletedDialog />

			{/* Shown to a guest the host wants to hand hosting to */}
			<HostHandoffDialog />

			{/* Progress and cancel for file downloads */}
			<TransferTray />

			{/* Holds the screen while a workspace that needs its host waits for it */}
			<HostGate />
		</div>
		</ChatProvider>
	);
}
