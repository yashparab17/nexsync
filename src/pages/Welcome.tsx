// React
import { useEffect, useState } from "react";

// React Router
import { useNavigate } from "react-router-dom";

// Icons
import { FolderOpen, FolderPlus, UsersRound } from "lucide-react";

// Hooks
import { useTheme } from "@/hooks/useTheme";
import { useErrorLog } from "@/hooks/useErrorLog";

// Components
import CreateWorkspaceDialog from "@/components/dialogs/workspace/CreateWorkspaceDialog";
import ImportWorkspaceDialog from "@/components/dialogs/workspace/ImportWorkspaceDialog";
import ThemeToggle from "@/components/elements/ThemeToggle";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

// Tauri
import { getRecentWorkspaces } from "@/lib/tauri";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// Types
import type { WorkspaceInfo } from "@/types/workspace";

// Assets
import logo from "@/assets/logos/logo.svg";
import logo_black from "@/assets/logos/logo-black.svg";
import logo_white from "@/assets/logos/logo-white.svg";

export default function Welcome() {
	// Hooks
	const { isDark } = useTheme();
	const navigate = useNavigate();

	// Workspace
	const { loadWorkspace: loadWs } = useWorkspace();
	const logError = useErrorLog();

	// States
	const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceInfo[]>(
		[],
	);
	const [loading, setLoading] = useState(true);

	// Styles
	const actionButtonClass =
		"px-8 text-base cursor-pointer hover:scale-[1.02] hover:border-primary";

	useEffect(() => {
		loadRecentWorkspaces();
	}, []);

	// Handlers
	const loadRecentWorkspaces = async () => {
		try {
			const workspaces = await getRecentWorkspaces();
			setRecentWorkspaces(workspaces);
		} catch (err) {
			console.error("Failed to load recent workspaces:", err);
			logError(err, { source: "recent_load" });
		} finally {
			setLoading(false);
		}
	};

	const handleOpenWorkspace = async (workspace: WorkspaceInfo) => {
		try {
			await loadWs(workspace);
			navigate("/workspace");
		} catch (err) {
			// The load failed (e.g. the folder was deleted). loadWorkspace
			// already set the error + failedWorkspace state, so the global
			// ErrorDialog will surface it. Stay on Welcome and refresh the
			// recent list — get_recent_workspaces prunes invalid entries.
			console.error("Failed to open workspace:", err);
			loadRecentWorkspaces();
		}
	};

	// Render
	return (
		<main className="flex min-h-screen flex-col p-8">
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

					<Button variant="ghost" size="icon">
						<UsersRound className="size-5" />
					</Button>
				</div>
			</header>

			{/* Tagline */}
			<p className="mt-2 text-center text-lg text-muted-foreground">
				Local-first collaborative workspaces.
			</p>

			{/* Main Content */}
			<section className="relative flex flex-1 flex-col items-center justify-center gap-6">
				{/* Background Image */}
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<img src={logo} className="h-150 w-150 opacity-10" alt="" />
				</div>

				<div className="relative z-2 flex flex-col items-center gap-6">
					<h1 className="text-center text-2xl font-semibold">
						Good evening, User.
					</h1>

					<p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
						Quick Actions
					</p>

					<div className="flex flex-wrap justify-center gap-6">
						<CreateWorkspaceDialog>
							<Button className={actionButtonClass}>
								<FolderPlus className="size-5" />
								Create Workspace
							</Button>
						</CreateWorkspaceDialog>

						<Button className={actionButtonClass}>
							<UsersRound className="size-5" />
							Join Workspace
						</Button>

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
							<p className="text-sm text-muted-foreground">
								Loading recent workspaces…
							</p>
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

											<p className="pt-2 text-green-500">
												● Synced
											</p>
										</CardHeader>
									</Card>
								))}
							</div>
						}
					</section>
				</div>
			</section>

			{/* Bottom */}
			<footer className="mt-auto space-y-1 pb-4 text-center text-muted-foreground">
				<p className="text-2xl">Nexsync 0.0.1</p>
				<p className="text-xs">
					Local First • Open Source • Built with Tauri
				</p>
			</footer>
		</main>
	);
}
