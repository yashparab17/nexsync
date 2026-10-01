// React Router
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// Components
import { t } from "@/i18n";
import WorkspaceSidebar from "@/components/layout/workspace/WorkspaceSidebar";
import WorkspaceHeader from "@/components/layout/workspace/WorkspaceHeader";
import JoinRequestDialog from "@/components/dialogs/workspace/JoinRequestDialog";
import WorkspaceDeletedDialog from "@/components/dialogs/workspace/WorkspaceDeletedDialog";
import HostHandoffDialog from "@/components/dialogs/workspace/HostHandoffDialog";
import TransferTray from "@/components/layout/workspace/TransferTray";
import DueReminders from "@/components/layout/workspace/DueReminders";

// Shell layout for all workspace sub-routes
export default function Workspace() {
	const { workspace, isLoading } = useWorkspace();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	// Below the medium breakpoint the sidebar is a drawer
	const [navOpen, setNavOpen] = useState(false);

	useEffect(() => {
		if (!navOpen) return;
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [navOpen]);

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
					<button type="button" aria-label={t("nav.close")} className="flex-1 cursor-default bg-black/50" onClick={() => setNavOpen(false)} />
				</div>
			)}

			{/* Main content area */}
			<div className="flex min-w-0 flex-1 flex-col">
				{/* Header */}
				<WorkspaceHeader onOpenMenu={() => setNavOpen(true)} menuOpen={navOpen} />

				{/* Page content */}
				<div className="flex-1 overflow-auto p-4 md:p-6">
					<div key={pathname} className="relative flex min-h-full flex-col animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
						<Outlet />
					</div>
				</div>
			</div>

			{/* Warns about work due today or late, whichever page is open */}
			<DueReminders />

			{/* Guests joining with a short code wait here for the host to allow them */}
			<JoinRequestDialog />

			{/* Shown to guests when the host deletes the workspace */}
			<WorkspaceDeletedDialog />

			{/* Shown to a guest the host wants to hand hosting to */}
			<HostHandoffDialog />

			{/* Progress and cancel for file downloads */}
			<TransferTray />
		</div>
	);
}
