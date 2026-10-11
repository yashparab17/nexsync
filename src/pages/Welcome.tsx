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

// Tauri IPC
import { APP_VERSION } from "@/lib/version";
import { getLastWorkspace, getRecentWorkspaces, loadConfig } from "@/lib/tauri";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// Types
import type { WorkspaceInfo } from "@/types/workspace";

// Assets
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
			// Only used to lead the list; not knowing it must not hide the list
			const last = (await getLastWorkspace().catch(() => null))?.id ?? null;
			setLastId(last);
			setRecentWorkspaces([...workspaces].sort((x, y) => Number(y.id === last) - Number(x.id === last)));
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
			<div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
				<header className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<img src={isDark ? logo_white : logo_black} alt="" className="size-9" />
						<span className="text-xl font-bold">Nexsync</span>
					</div>
					<div className="flex items-center gap-1">
						<ThemeToggle />
						<Button variant="ghost" size="icon" onPress={() => setSettingsOpen(true)} aria-label="Application Settings">
							<SettingsIcon className="size-5" />
						</Button>
					</div>
				</header>

				<main className="flex flex-1 flex-col gap-10 pt-16">
					<div>
						<h1 className="text-4xl font-bold tracking-tight">{greeting}</h1>
						<p className="mt-2 max-w-prose text-muted-foreground">
							Notes, tasks and code, shared with your team and kept on your own computer.
						</p>
					</div>

					{/* Opening a workspace is the common case, so the list comes first and the last one used leads it */}
					<section aria-labelledby="recent-heading" className="flex flex-col gap-3">
						<h2 id="recent-heading" className="text-lg font-semibold">Your workspaces</h2>

						{loading ?
							<Loading />
						: recentWorkspaces.length === 0 ?
							<p className="border border-dashed p-6 text-muted-foreground">
								No workspaces yet. Create one below, or join a teammate with their ticket.
							</p>
						:	<ul className="divide-y border">
								{recentWorkspaces.map((ws) => (
									<li key={ws.id}>
										<button
											type="button"
											onClick={() => handleOpenWorkspace(ws)}
											className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted border-l-2 ${ws.id === lastId ? "border-primary bg-primary/5" : "border-transparent"}`}
										>
											<span className="min-w-0">
												<span className="block font-semibold">{ws.name}</span>
												<span className="block truncate font-mono text-xs text-muted-foreground">{ws.path}</span>
											</span>
											<span className="shrink-0 text-sm text-primary">
												{ws.id === lastId ? "Continue" : "Open"}
											</span>
										</button>
									</li>
								))}
							</ul>
						}
					</section>

					<div className="flex flex-wrap gap-3">
						<CreateWorkspaceDialog>
							<Button><FolderPlus className="size-5" />Create workspace</Button>
						</CreateWorkspaceDialog>
						<JoinWorkspaceDialog>
							<Button variant="outline"><UsersRound className="size-5" />Join with a ticket</Button>
						</JoinWorkspaceDialog>
						<ImportWorkspaceDialog>
							<Button variant="outline"><FolderOpen className="size-5" />Import a folder</Button>
						</ImportWorkspaceDialog>
					</div>
				</main>

				<footer className="mt-16 flex items-center justify-between text-sm text-muted-foreground">
					<span>Nexsync {APP_VERSION} · Local first, open source</span>
					<Button variant="link" size="sm" onPress={() => setTourOpen(true)}>{t("welcome.tour")}</Button>
				</footer>
			</div>

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
