// Icons
import { Search, Settings } from "lucide-react";

// Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Context
import { useWorkspace } from "@/store/WorkspaceContext";

export default function WorkspaceHeader() {
	const { workspace } = useWorkspace();

	return (
		<header className="flex h-16 items-center justify-between border-b px-6">
			<h1 className="font-semibold">{workspace?.name}</h1>

			<div className="flex items-center gap-3">
				<div className="relative">
					<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

					<Input
						placeholder="Search workspace..."
						className="w-64 pl-9"
					/>
				</div>

				<Button variant="ghost" size="icon">
					<Settings className="size-5" />
				</Button>
			</div>
		</header>
	);
}
