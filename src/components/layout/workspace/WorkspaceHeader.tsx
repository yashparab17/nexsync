// React Router
import { useNavigate } from "react-router-dom";

// Icons
import { Search, Settings } from "lucide-react";

// Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Header component for the workspace layout
export default function WorkspaceHeader() {
	const navigate = useNavigate();

	return (
		<header className="relative flex h-16 shrink-0 items-center border-b px-6">
			{/* Search */}
			<div className="absolute left-1/2 -translate-x-1/2">
				<div className="flex w-80 items-center border bg-background">
					<Input
						placeholder="Search workspace..."
						className="flex-1 border-0 pl-3"
					/>

					<Button variant="outline" size="icon">
						<Search className="size-4" />
					</Button>
				</div>
			</div>

			{/* Right Actions */}
			<div className="ml-auto">
				<Button
					variant="ghost"
					size="icon"
					onPress={() => navigate("/workspace/settings")}
					aria-label="Open workspace settings"
				>
					<Settings className="size-5" />
				</Button>
			</div>
		</header>
	);
}
