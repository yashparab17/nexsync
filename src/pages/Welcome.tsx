// React
import { lazy, Suspense, useEffect, useState } from "react";

// React Router
import { useNavigate } from "react-router-dom";

// Icons
import { FolderOpen, FolderPlus, HardDrive, Lock, Settings as SettingsIcon, UserX, UsersRound } from "lucide-react";

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

// Keys that work from any workspace screen
const shortcuts: [string, string][] = [
	["Ctrl K", "Search and commands"],
	["Ctrl S", "Save the open note or file"],
	["[[name]]", "Link to another note"],
];

// Action tiles in the side column share one shape
const tile = "h-auto w-full justify-start gap-4 px-5 py-4 text-left";

// "edited 3h ago" from an ISO timestamp; empty when the registry has none
function editedAgo(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	if (!iso || Number.isNaN(ms)) return "";
	const m = Math.floor(Math.max(0, ms) / 60_000);
	if (m < 1) return "edited just now";
	if (m < 60) return `edited ${m}m ago`;
	if (m < 1440) return `edited ${Math.floor(m / 60)}h ago`;
	if (m < 10080) return `edited ${Math.floor(m / 1440)}d ago`;
	return `edited ${new Date(iso).toLocaleDateString()}`;
}

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
		<div className="flex min-h-full flex-col px-8 py-6 2xl:px-16">
			<header className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<img src={isDark ? logo_white : logo_black} alt="" className="size-9" />
					<span className="text-xl font-bold">Nexsync</span>
					<span className="font-mono text-xs text-muted-foreground">v{APP_VERSION}</span>
				</div>
				<div className="flex items-center gap-1">
					<Button variant="ghost" size="sm" onPress={() => setTourOpen(true)}>{t("welcome.tour")}</Button>
					<ThemeToggle />
					<Button variant="ghost" size="icon" onPress={() => setSettingsOpen(true)} aria-label="Application Settings">
						<SettingsIcon className="size-5" />
					</Button>
				</div>
			</header>

			{/* The window is the canvas: content fills it up to a wide cap, centred in both directions */}
			<main className="flex flex-1 items-center justify-center py-12">
				<div className="grid w-full max-w-[88rem] gap-12 xl:grid-cols-[minmax(0,1fr)_24rem] xl:gap-16">
					<div className="flex min-w-0 flex-col gap-10">
						<div>
							<h1 className="text-5xl font-bold tracking-tight 2xl:text-6xl">{greeting}</h1>
							<p className="mt-3 max-w-prose text-lg text-muted-foreground">
								Notes, tasks and code, shared with your team and kept on your own computer.
							</p>
						</div>

						{/* Opening a workspace is the common case, so the list comes first and the last one used leads it */}
						<section aria-labelledby="recent-heading" className="flex flex-col gap-4">
							<h2 id="recent-heading" className="font-mono text-sm text-muted-foreground">
								workspaces / {recentWorkspaces.length}
							</h2>

							{loading ?
								<Loading />
							: recentWorkspaces.length === 0 ?
								<p className="border border-dashed p-8 text-muted-foreground">
									No workspaces yet. Create one, or join a teammate with their ticket.
								</p>
							:	<ul className="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-4">
									{recentWorkspaces.map((ws) => {
										const last = ws.id === lastId;
										return (
											<li key={ws.id}>
												<button
													type="button"
													onClick={() => handleOpenWorkspace(ws)}
													className={`flex h-full min-h-44 w-full flex-col gap-3 border bg-card p-6 text-left shadow-[0_2px_0_var(--edge)] transition-colors hover:border-primary active:translate-y-0.5 active:shadow-none ${last ? "border-primary" : ""}`}
												>
													<span className="flex items-start justify-between gap-3">
														<span className={`font-semibold text-xl`}>{ws.name}</span>
														{last && <span className="shrink-0 bg-primary px-2 py-0.5 text-sm font-medium text-primary-foreground">Continue</span>}
													</span>
													{ws.description && <span className="line-clamp-2 text-muted-foreground">{ws.description}</span>}
													<span className="mt-auto flex flex-col gap-1 font-mono text-xs text-muted-foreground">
														<span className="truncate">{ws.path}</span>
														<span>{editedAgo(ws.updated_at)}</span>
													</span>
												</button>
											</li>
										);
									})}
								</ul>
							}
						</section>
					</div>

					<aside className="flex flex-col gap-8">
						<section className="flex flex-col gap-3">
							<h2 className="font-mono text-sm text-muted-foreground">start</h2>
							<CreateWorkspaceDialog>
								<Button className={tile}>
									<FolderPlus className="size-6 shrink-0" />
									<span><span className="block font-semibold">Create a workspace</span><span className="block text-sm font-normal opacity-80">A new folder on this computer</span></span>
								</Button>
							</CreateWorkspaceDialog>
							<JoinWorkspaceDialog>
								<Button variant="outline" className={tile}>
									<UsersRound className="size-6 shrink-0" />
									<span><span className="block font-semibold">Join with a ticket</span><span className="block text-sm font-normal text-muted-foreground">Paste what a teammate sent you</span></span>
								</Button>
							</JoinWorkspaceDialog>
							<ImportWorkspaceDialog>
								<Button variant="outline" className={tile}>
									<FolderOpen className="size-6 shrink-0" />
									<span><span className="block font-semibold">Import a folder</span><span className="block text-sm font-normal text-muted-foreground">Use files you already have</span></span>
								</Button>
							</ImportWorkspaceDialog>
						</section>

						<section className="flex flex-col gap-3">
							<h2 className="font-mono text-sm text-muted-foreground">shortcuts</h2>
							<dl className="flex flex-col gap-2 text-sm">
								{shortcuts.map(([keys, what]) => (
									<div key={what} className="flex items-center justify-between gap-4">
										<dt>{what}</dt>
										<dd><kbd className="border bg-card px-2 py-0.5 font-mono text-xs shadow-[0_2px_0_var(--edge)]">{keys}</kbd></dd>
									</div>
								))}
							</dl>
						</section>

						<section className="flex flex-col gap-3">
							<h2 className="font-mono text-sm text-muted-foreground">your data</h2>
							<ul className="flex flex-col gap-2 text-sm text-muted-foreground">
								<li className="flex gap-3"><HardDrive className="size-4 shrink-0 text-primary" />Files stay as plain files in folders you choose.</li>
								<li className="flex gap-3"><Lock className="size-4 shrink-0 text-primary" />Connections between devices are end-to-end encrypted.</li>
								<li className="flex gap-3"><UserX className="size-4 shrink-0 text-primary" />No account and no server holds your work.</li>
							</ul>
						</section>
					</aside>
				</div>
			</main>

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
