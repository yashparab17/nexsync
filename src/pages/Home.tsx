import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	CardDescription,
} from "@/components/ui/card";

export default function Home() {
	const navigate = useNavigate();

	return (
		<main className="min-h-screen bg-background p-8">
			<div className="mx-auto flex max-w-5xl flex-col gap-8">
				{/* Header */}

				<header className="flex items-center justify-between">
					<div>
						<h1 className="text-4xl font-bold">Nexsync</h1>

						<p className="text-muted-foreground">
							Local-first collaborative workspace.
						</p>
					</div>

					<nav className="flex gap-2">
						<Button onPress={() => navigate("/")}>Home</Button>

						<Button onPress={() => navigate("/workspace")}>
							Workspace
						</Button>

						<Button onPress={() => navigate("/settings")}>
							Settings
						</Button>
					</nav>
				</header>

				{/* Welcome Card */}

				<Card>
					<CardHeader>
						<CardTitle>Welcome to Nexsync</CardTitle>

						<CardDescription>
							Build, organize and collaborate from one local-first
							workspace.
						</CardDescription>
					</CardHeader>

					<CardContent className="flex gap-4">
						<Button>Create Workspace</Button>

						<Button variant="outline">Open Existing</Button>
					</CardContent>
				</Card>
			</div>
		</main>
	);
}
