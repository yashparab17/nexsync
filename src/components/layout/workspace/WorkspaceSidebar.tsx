// React
import type { ElementType } from "react";

// React Router
import { NavLink, useNavigate } from "react-router-dom";

// Icons
import {
	ArrowLeft,
	Files,
	FolderOpen,
	KanbanSquare,
	LayoutDashboard,
	ListTodo,
	Settings,
	UsersRound,
} from "lucide-react";

// Components
import { Button } from "@/components/ui/button";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

interface NavigationItem {
	name: string;
	path: string;
	icon: ElementType;
	end?: boolean;
}

const navigation: NavigationItem[] = [
	{
		name: "Dashboard",
		path: "/workspace",
		icon: LayoutDashboard,
		end: true,
	},
	{
		name: "Files",
		path: "/workspace/files",
		icon: Files,
	},
	{
		name: "Assets",
		path: "/workspace/assets",
		icon: FolderOpen,
	},
	{
		name: "Tasks",
		path: "/workspace/tasks",
		icon: ListTodo,
	},
	{
		name: "Kanban",
		path: "/workspace/kanban",
		icon: KanbanSquare,
	},
];

const bottomNavigation: NavigationItem[] = [
	{
		name: "Members",
		path: "/workspace/members",
		icon: UsersRound,
	},
	{
		name: "Settings",
		path: "/workspace/settings",
		icon: Settings,
	},
];

function NavigationItem({ item }: { item: NavigationItem }) {
	const Icon = item.icon;

	return (
		<NavLink
			to={item.path}
			end={item.end}
			className={({ isActive }) =>
				`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
					isActive ?
						"bg-primary/10 text-primary"
					:	"text-foreground hover:bg-muted"
				}`
			}
		>
			<Icon className="size-4" />
			{item.name}
		</NavLink>
	);
}

export default function WorkspaceSidebar() {
	const { workspace, clearWorkspace } = useWorkspace();
	const navigate = useNavigate();

	const handleBackToWelcome = () => {
		clearWorkspace();
		navigate("/");
	};

	return (
		<aside className="flex h-full w-64 flex-col border-r bg-muted/20">
			{/* Workspace identity */}
			<div className="flex h-16 shrink-0 items-center gap-2 border-b px-3">
				<Button
					variant="ghost"
					size="icon"
					onPress={handleBackToWelcome}
					aria-label="Back to welcome"
				>
					<ArrowLeft className="size-5" />
				</Button>

				<h2 className="truncate font-semibold">{workspace?.name}</h2>
			</div>

			{/* Main Navigation */}
			<nav className="flex-1 space-y-1 p-3">
				{navigation.map((item) => (
					<NavigationItem key={item.path} item={item} />
				))}
			</nav>

			{/* Bottom Navigation */}
			<nav className="space-y-1 border-t p-3">
				{bottomNavigation.map((item) => (
					<NavigationItem key={item.path} item={item} />
				))}
			</nav>
		</aside>
	);
}
