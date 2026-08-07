// React / React Router
import { useNavigate } from "react-router-dom";

// Icons
import { FolderOpen, FolderPlus, UsersRound } from "lucide-react";

// Components
import CreateWorkspaceDialog from "@/components/dialogs/CreateWorkspaceDialog";
import ImportWorkspaceDialog from "@/components/dialogs/ImportWorkspaceDialog";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

// Assets
import logo from "@/assets/logo.svg";
import logo_white from "@/assets/logo-white.svg";

export default function Welcome() {
	const navigate = useNavigate();

	return (
		<main className="flex min-h-screen flex-col bg-background p-8">
			{/* Header */}
			<header className="relative flex items-center justify-center">
				<div className="flex items-center gap-3">
					<img src={logo_white} alt="Nexsync" className="h-12 w-12" />

					<h1 className="text-5xl font-bold">Nexsync</h1>
				</div>

				<Button
					variant="ghost"
					size="icon"
					className="absolute right-0"
				>
					<UsersRound className="size-8" />
				</Button>
			</header>

			{/* Tagline */}
			<div className="flex items-center justify-center">
				<p className="mt-2 text-lg text-muted-foreground">
					Local-first collaborative workspaces.
				</p>
			</div>

			{/* Main Content */}
			<section className="relative flex flex-1 flex-col items-center justify-center gap-6">
				{/* Background Image */}
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<img
						src={logo}
						className="w-150 h-150 opacity-[0.1]"
						alt=""
					/>
				</div>

				<div className="relative z-2 flex flex-col items-center gap-6">
					<h1 className="text-2xl font-semibold text-center">
						Good evening, User.
					</h1>

					<h1 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
						Quick Actions
					</h1>

					<div className="flex flex-wrap justify-center gap-6">
						<CreateWorkspaceDialog>
							<Button className="px-8 py-6 text-base cursor-pointer transition-all hover:scale-[1.02] hover:border-primary">
								<FolderPlus className="size-5" />
								Create Workspace
							</Button>
						</CreateWorkspaceDialog>

						<Button className="px-8 py-6 text-base cursor-pointer transition-all hover:scale-[1.02] hover:border-primary">
							<UsersRound className="size-5" />
							Join Workspace
						</Button>

						<ImportWorkspaceDialog>
							<Button className="px-8 py-6 text-base cursor-pointer transition-all hover:scale-[1.02] hover:border-primary">
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

						<div className="flex flex-wrap justify-center gap-6">
							<Card className="w-80 cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:border-primary hover:shadow-lg">
								<CardHeader>
									<CardTitle>MSc Project</CardTitle>

									<CardDescription>
										Last opened 2 hours ago
									</CardDescription>

									<p className="pt-2 text-sm text-green-500">
										● Synced
									</p>
								</CardHeader>
							</Card>

							<Card className="w-80 cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:border-primary hover:shadow-lg">
								<CardHeader>
									<CardTitle>Research Project</CardTitle>

									<CardDescription>
										Last opened 4 hours ago
									</CardDescription>

									<p className="pt-2 text-sm text-green-500">
										● Synced
									</p>
								</CardHeader>
							</Card>
						</div>
					</section>
				</div>
			</section>

			{/* Bottom */}
			<Button onPress={() => navigate("/workspace")}>
				Go to Workspace
			</Button>
			<footer className="mt-auto space-y-1 pb-4 text-center text-muted-foreground">
				<p className="text-muted-foreground text-2xl">Nexsync 0.0.1</p>
				<p className="text-muted-foreground text-xs">
					Local First • Open Source • Built with Tauri
				</p>
			</footer>
		</main>
	);
}
