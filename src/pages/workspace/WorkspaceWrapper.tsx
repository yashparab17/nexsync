// React Router
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P } from "@/store/p2p/P2PContext";
import { pageOf } from "@/lib/p2p/presence";

// Components
import { t } from "@/i18n";
import WorkspaceSidebar from "@/components/layout/workspace/WorkspaceSidebar";
import WorkspaceHeader from "@/components/layout/workspace/WorkspaceHeader";
import JoinRequestDialog from "@/components/dialogs/workspace/JoinRequestDialog";
import WorkspaceDeletedDialog from "@/components/dialogs/workspace/WorkspaceDeletedDialog";
import HostHandoffDialog from "@/components/dialogs/workspace/HostHandoffDialog";
import TransferTray from "@/components/layout/workspace/TransferTray";
import HostGate from "@/components/layout/workspace/HostGate";
import DueReminders from "@/components/layout/workspace/DueReminders";
import DependencyWatch from "@/components/layout/workspace/DependencyWatch";
import FollowWatch from "@/components/layout/workspace/FollowWatch";
import ShortcutsDialog from "@/components/dialogs/workspace/ShortcutsDialog";
import { shortcutFor } from "@/lib/shortcuts";
import { ChatProvider } from "@/store/chat/ChatContext";
import { ModerationExecutor, RejoinWatch, TimeoutBanner } from "@/components/moderation/ModerationRuntime";
import AnnouncementRuntime from "@/components/announcements/AnnouncementRuntime";
import ReviewBanner from "@/components/moderation/ReviewBanner";

// Shell layout for all workspace sub-routes
export default function Workspace() {
	const { workspace, isLoading } = useWorkspace();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	// The Editor, Notes, Files and Assets are full-bleed workspaces: no page padding, and they fill the window
	// Below the medium breakpoint the sidebar is a drawer
	const [navOpen, setNavOpen] = useState(false);

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
			<div className="hidden h-full md:block">
				<WorkspaceSidebar />
			</div>

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
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background window-edge">
				{/* Header */}
				<WorkspaceHeader onOpenMenu={() => setNavOpen(true)} menuOpen={navOpen} />
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
