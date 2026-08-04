import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
} from "@/components/ui/card";
import { FolderPlus, FolderOpen, UsersRound } from "lucide-react";

export default function Welcome() {
	const navigate = useNavigate();

	return (
		<main className="flex min-h-screen flex-col bg-background p-8">
			{/* Header */}
			<header className="relative flex items-center justify-center">
				<div></div>
				<h1 className="text-5xl font-bold">Nexsync</h1>
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
			<section className="flex flex-1 flex-col items-center justify-center gap-6">
				<h1 className="text-2xl font-semibold text-center">
					Good evening, User.
				</h1>

				<h1 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
					Quick Actions
				</h1>

				<div className="flex flex-wrap justify-center gap-6">
					<Button className="px-8 py-6 text-base cursor-pointer transition-all hover:scale-[1.02] hover:border-primary">
						<FolderPlus className="size-5" />
						Create Workspace
					</Button>

					<Button className="px-8 py-6 text-base cursor-pointer transition-all hover:scale-[1.02] hover:border-primary">
						<UsersRound className="size-5" />
						Join Workspace
					</Button>

					<Button className="px-8 py-6 text-base cursor-pointer transition-all hover:scale-[1.02] hover:border-primary">
						<FolderOpen className="size-5" />
						Import Workspace
					</Button>
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
			</section>

			{/* Bottom */}
			<footer className="mt-auto space-y-1 pb-4 text-center text-muted-foreground">
				<p className="text-muted-foreground text-2xl">Nexsync 0.0.1</p>
				<p className="text-muted-foreground text-xs">
					Local First • Open Source • Built with Tauri
				</p>
			</footer>
		</main>
	);
}
