// Icons
import { Search, Settings } from "lucide-react";

// Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function WorkspaceHeader() {
	return (
		<header className="relative flex h-16 shrink-0 items-center border-b px-6">
			{/* Search */}
			<div className="absolute left-1/2 -translate-x-1/2">
				<div className="flex w-80 items-center border bg-background">
					<Input
						placeholder="Search workspace..."
						className="border-0 pl-3 focus-visible:ring-0"
					/>

					<Button
						variant="outline"
						size="icon"
						className="shrink-0 rounded-none"
					>
						<Search className="size-4" />
					</Button>
				</div>
			</div>

			{/* Right Actions */}
			<div className="ml-auto">
				<Button variant="ghost" size="icon">
					<Settings className="size-5" />
				</Button>
			</div>
		</header>
	);
}
