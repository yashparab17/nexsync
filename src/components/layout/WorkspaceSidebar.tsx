// Icons
import {
	Files,
	KanbanSquare,
	LayoutDashboard,
	ListTodo,
	Settings,
	UsersRound,
} from "lucide-react";

// Components
import { Button } from "@/components/ui/button";

// Context
import { useWorkspace } from "@/store/WorkspaceContext";

export default function WorkspaceSidebar() {
	const { workspace } = useWorkspace();

	return (
		<aside className="flex w-64 flex-col border-r bg-muted/20">
			{/* Workspace identity */}
			<div className="flex h-16 items-center border-b px-4">
				<h2 className="truncate font-semibold">{workspace?.name}</h2>
			</div>

			{/* Navigation */}
			<nav className="flex-1 space-y-1 p-3">
				<Button variant="ghost" className="w-full justify-start">
					<LayoutDashboard className="mr-3 size-4" />
					Dashboard
				</Button>

				<Button variant="ghost" className="w-full justify-start">
					<Files className="mr-3 size-4" />
					Files
				</Button>

				<Button variant="ghost" className="w-full justify-start">
					<ListTodo className="mr-3 size-4" />
					Tasks
				</Button>

				<Button variant="ghost" className="w-full justify-start">
					<KanbanSquare className="mr-3 size-4" />
					Kanban
				</Button>

				<Button variant="ghost" className="w-full justify-start">
					<UsersRound className="mr-3 size-4" />
					Members
				</Button>
			</nav>

			{/* Bottom */}
			<div className="border-t p-3">
				<Button variant="ghost" className="w-full justify-start">
					<Settings className="mr-3 size-4" />
					Settings
				</Button>
			</div>
		</aside>
	);
}
