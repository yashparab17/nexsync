// React
import { lazy, Suspense, useEffect, useState } from "react";

// React Router
import { useNavigate } from "react-router-dom";

// Icons
import { FolderOpen, FolderPlus, Settings as SettingsIcon, UsersRound } from "lucide-react";

// Hooks
import { useThemeContext } from "@/store/ThemeContext";
import { useErrorLog } from "@/hooks/useErrorLog";

// Components
import CreateWorkspaceDialog from "@/components/dialogs/workspace/CreateWorkspaceDialog";
import ImportWorkspaceDialog from "@/components/dialogs/workspace/ImportWorkspaceDialog";
import JoinWorkspaceDialog from "@/components/dialogs/workspace/JoinWorkspaceDialog";
import ThemeToggle from "@/components/elements/ThemeToggle";


import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

const Settings = lazy(() => import("@/pages/Settings"));
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

// Tauri IPC
import { getLastWorkspace, getRecentWorkspaces, loadConfig } from "@/lib/tauri";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// Types
import type { WorkspaceInfo } from "@/types/workspace";

// Assets
import logo from "@/assets/logos/logo.svg";
import logo_black from "@/assets/logos/logo-black.svg";
import logo_white from "@/assets/logos/logo-white.svg";
import Loading from "@/components/Loading";
import OnboardingTour, { tourSeen } from "@/components/dialogs/OnboardingTour";
import { t } from "@/i18n";

// Welcome landing page with recent workspaces and quick actions
export default function Welcome() {
	// Hooks
	const { isDark } = useThemeContext();
	const navigate = useNavigate();

	// Workspace state & logging
	const { loadWorkspace: loadWs } = useWorkspace();
	const logError = useErrorLog();

	// Local states
	const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceInfo[]>(
		[],
	);
	const [loading, setLoading] = useState(true);
	// The workspace that was open when the app was last used
	const [lastId, setLastId] = useState<string | null>(null);
	// The name from Settings, for the greeting; empty until loaded or when none is set
	const [userName, setUserName] = useState("");

	// "Good morning, Yash." from the time of day and the name in Settings; without a name, just the greeting
	const hour = new Date().getHours();
	const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
	const greeting = userName ? t(`welcome.${part}` as const, { name: userName }) : t(`welcome.${part}NoName` as const);

	// The introduction opens by itself the first time, and from the link below after that
	const [tourOpen, setTourOpen] = useState(() => !tourSeen());
	const [settingsOpen, setSettingsOpen] = useState(false);

	// Shared button styling
	const actionButtonClass =
		"px-8 text-base cursor-pointer hover:scale-[1.02] hover:border-primary";

	// Load recent workspaces on mount
	useEffect(() => {
		loadRecentWorkspaces();
		loadConfig()
			.then((config) => setUserName(config.display_name.trim()))
			.catch(() => {});
	}, []);

	// Fetch recent workspaces from backend registry
	const loadRecentWorkspaces = async () => {
		try {
			const workspaces = await getRecentWorkspaces();
			setRecentWorkspaces(workspaces);
			// Only used to mark the card; not knowing it must not hide the list
			setLastId((await getLastWorkspace().catch(() => null))?.id ?? null);
		} catch (err) {
			console.error("Failed to load recent workspaces:", err);
			logError(err, { source: "recent_load" });
		} finally {
			setLoading(false);
		}
	};

	// Open selected workspace and navigate to dashboard
	const handleOpenWorkspace = async (workspace: WorkspaceInfo) => {
		try {
			await loadWs(workspace);
			navigate("/workspace");
		} catch (err) {
			console.error("Failed to open workspace:", err);
			loadRecentWorkspaces();
		}
	};

	return (
		<div className="flex min-h-full flex-col p-8">
			{/* Header */}
			<header className="relative flex items-center justify-center">
				<div className="flex items-center gap-3">
					<img
						src={isDark ? logo_white : logo_black}
						alt="Nexsync"
						className="h-12 w-12"
					/>

					<h1 className="text-5xl font-bold">Nexsync</h1>
				</div>

				<div className="absolute right-0 flex items-center gap-2">
					<ThemeToggle />

					<Button
						variant="ghost"
						size="icon"
						onPress={() => setSettingsOpen(true)}
						aria-label="Application Settings"
					>
						<SettingsIcon className="size-5" />
					</Button>
				</div>
			</header>

			{/* Tagline */}
			<p className="mt-2 text-center text-lg text-muted-foreground">
				Notes, tasks and code, shared with your team and kept on your own computer.
			</p>

			{/* Main Content */}
			<section className="relative flex flex-1 flex-col items-center justify-center gap-6">
				{/* Background Image */}
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<img src={logo} className="h-150 w-150 opacity-10" alt="" />
				</div>

				<div className="relative z-2 flex flex-col items-center gap-6">
					<h2 className="text-center text-2xl font-semibold">{greeting}</h2>

					<p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
						Quick Actions
					</p>

					{/* Action Buttons */}
					<div className="flex flex-wrap justify-center gap-6">
						<CreateWorkspaceDialog>
							<Button className={actionButtonClass}>
								<FolderPlus className="size-5" />
								Create Workspace
							</Button>
						</CreateWorkspaceDialog>

						<JoinWorkspaceDialog>
							<Button className={actionButtonClass}>
								<UsersRound className="size-5" />
								Join Workspace
							</Button>
						</JoinWorkspaceDialog>

						<ImportWorkspaceDialog>
							<Button className={actionButtonClass}>
								<FolderOpen className="size-5" />
								Import Workspace
							</Button>
						</ImportWorkspaceDialog>
					</div>


					{/* Recent Workspaces */}
					<section className="flex w-full flex-col items-center gap-4">
						<h2 className="text-2xl font-semibold">
							Recent Workspaces
						</h2>

						{loading ?
							<Loading />
						: recentWorkspaces.length === 0 ?
							<p className="text-sm text-muted-foreground">
								No recent workspaces. Create or import one to
								get started.
							</p>
						:	<div className="flex flex-wrap justify-center gap-6">
								{recentWorkspaces.map((ws) => (
									<Card
										key={ws.id}
										className="w-80 cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:border-primary hover:shadow-lg"
										onClick={() => handleOpenWorkspace(ws)}
									>
										<CardHeader>
											<CardTitle>{ws.name}</CardTitle>

											<CardDescription>
												{ws.description ||
													"Local Workspace"}
											</CardDescription>

											{ws.id === lastId && (
												<p className="pt-2 text-sm text-muted-foreground">
													You visited this last time
												</p>
											)}
										</CardHeader>
									</Card>
								))}
							</div>
						}
					</section>
				</div>
			</section>

			{/* Footer */}
			<footer className="mt-auto space-y-1 pb-4 text-center text-muted-foreground">
				<p className="text-2xl">Nexsync 0.6.7</p>
				<p className="text-xs">
					Local First • Open Source • Built with Tauri
				</p>
				<Button variant="link" size="sm" onPress={() => setTourOpen(true)}>
					{t("welcome.tour")}
				</Button>
			</footer>

			{/* Settings opens over the page; the page asks before closing with unsaved edits, so Escape and a click outside are off */}
			<Dialog isOpen={settingsOpen} onOpenChange={setSettingsOpen} showCloseButton={false} isDismissable={false} isKeyboardDismissDisabled className="overflow-hidden p-0 sm:max-w-5xl">
				{settingsOpen && (
					<Suspense fallback={<div className="h-[85vh]" />}>
						<Settings onClose={() => setSettingsOpen(false)} />
					</Suspense>
				)}
			</Dialog>

			<OnboardingTour open={tourOpen} onClose={() => setTourOpen(false)} />
		</div>
	);
}
