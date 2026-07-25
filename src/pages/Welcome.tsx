import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	CardDescription,
} from "@/components/ui/card";

export default function Welcome() {
	const navigate = useNavigate();

	return (
		<main className="flex min-h-screen flex-col bg-background p-8">
			{/* Header */}
			<header className="text-center">
				<h1 className="text-5xl font-bold">Nexsync</h1>

				<p className="mt-2 text-lg text-muted-foreground">
					Local-first collaborative workspaces.
				</p>
			</header>

			{/* Main Content */}
			<section className="flex flex-1 flex-col items-center justify-center gap-10">
				<h2 className="text-2xl font-semibold">Good evening, User.</h2>

				<div className="flex flex-wrap justify-center gap-6">
					<Button className="px-8 py-6 text-base">
						Create Workspace
					</Button>

					<Button className="px-8 py-6 text-base">
						Join Workspace
					</Button>

					<Button className="px-8 py-6 text-base">
						Import Workspace
					</Button>
				</div>

				{/* Recent Workspaces */}
				<section className="flex w-full flex-col items-center gap-4">
					<h2 className="text-2xl font-semibold">
						Recent Workspaces
					</h2>

					<div className="flex flex-wrap justify-center gap-6">
						<Card className="w-72 cursor-pointer transition-all hover:scale-[1.02] hover:border-primary">
							<CardHeader>
								<CardTitle>Workspace Name</CardTitle>
								<CardDescription>
									Last opened 2 hours ago
								</CardDescription>
							</CardHeader>
						</Card>

						<Card className="w-72 cursor-pointer transition-all hover:scale-[1.02] hover:border-primary">
							<CardHeader>
								<CardTitle>Research Project</CardTitle>
								<CardDescription>
									Last opened Yesterday
								</CardDescription>
							</CardHeader>
						</Card>
					</div>
				</section>
			</section>

			{/* Bottom */}
			<footer className="mt-auto pb-4 text-center">
				<h2 className="text-muted-foreground">Nexsync v0.1</h2>
			</footer>
		</main>
	);
}
