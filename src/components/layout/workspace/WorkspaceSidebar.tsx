// React
import type { ElementType } from "react";

// React Router
import { NavLink, useNavigate } from "react-router-dom";

// Icons
import {
	ArrowLeft,
	BarChart3,
	Code2,
	Files,
	FolderOpen,
	KanbanSquare,
	LayoutDashboard,
	ListTodo,
	Settings,
	StickyNote,
	Trash2,
	UsersRound,
} from "lucide-react";

// Components
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

interface NavigationItem {
	name: string;
	label: MessageKey; // The text shown, looked up in the language catalog
	path: string;
	icon: ElementType;
	end?: boolean;
}

// Workspace feature navigation links
const navigation: NavigationItem[] = [
	{
		name: "Dashboard",
		label: "nav.dashboard",
		path: "/workspace",
		icon: LayoutDashboard,
		end: true,
	},
	{
		name: "Notes",
		label: "nav.notes",
		path: "/workspace/notes",
		icon: StickyNote,
	},
	{
		name: "Editor",
		label: "nav.editor",
		path: "/workspace/editor",
		icon: Code2,
	},
	{
		name: "Files",
		label: "nav.files",
		path: "/workspace/files",
		icon: Files,
	},
	{
		name: "Assets",
		label: "nav.assets",
		path: "/workspace/assets",
		icon: FolderOpen,
	},
	{
		name: "Tasks",
		label: "nav.tasks",
		path: "/workspace/tasks",
		icon: ListTodo,
	},
	{
		name: "Kanban",
		label: "nav.kanban",
		path: "/workspace/kanban",
		icon: KanbanSquare,
	},
	{
		name: "Insights",
		label: "nav.insights",
		path: "/workspace/insights",
		icon: BarChart3,
	},
];

// Bottom workspace navigation links
const bottomNavigation: NavigationItem[] = [
	{
		name: "Members",
		label: "nav.members",
		path: "/workspace/members",
		icon: UsersRound,
	},
	{
		name: "Trash",
		label: "nav.trash",
		path: "/workspace/trash",
		icon: Trash2,
	},
	{
		name: "Settings",
		label: "nav.settings",
		path: "/workspace/settings",
		icon: Settings,
	},
];

// Sidebar navigation link component
function NavigationItem({ item, expanded, onNavigate }: { item: NavigationItem; expanded: boolean; onNavigate?: () => void }) {
	const Icon = item.icon;

	return (
		<NavLink
			to={item.path}
			end={item.end}
			onClick={onNavigate}
			className={({ isActive }) =>
				cn(
					"flex w-full items-center gap-3 rounded-none px-3 py-2 text-sm font-medium transition-colors",
					expanded ? "justify-start" : "justify-center lg:justify-start",
					isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
				)
			}
			title={t(item.label)}
			aria-label={t(item.label)}
		>
			<Icon className="size-4 shrink-0" aria-hidden />
			<span className={expanded ? "inline" : "hidden lg:inline"}>{t(item.label)}</span>
		</NavLink>
	);
}

// Left sidebar navigation bar for workspace views
// `expanded` is the drawer on small windows: full width with labels, and `onNavigate` closes it after a choice
export default function WorkspaceSidebar({ expanded = false, onNavigate }: { expanded?: boolean; onNavigate?: () => void }) {
	const { workspace, clearWorkspace } = useWorkspace();
	const navigate = useNavigate();

	// Unload workspace and return to Welcome view
	const handleBackToWelcome = async () => {
		await clearWorkspace();
		navigate("/");
	};

	return (
		<aside className={cn("flex h-full shrink-0 flex-col border-r bg-muted/20", expanded ? "w-64 bg-background" : "w-14 lg:w-64")}>
			{/* Workspace identity */}
			<div className={cn("flex h-16 shrink-0 items-center gap-2 border-b", expanded ? "justify-start px-3" : "justify-center lg:justify-start lg:px-3")}>
				<Button
					variant="ghost"
					size="icon"
					onPress={handleBackToWelcome}
					aria-label="Back to welcome"
				>
					<ArrowLeft className="size-5" />
				</Button>

				<h2 className={cn("truncate font-semibold", expanded ? "block" : "hidden lg:block")}>{workspace?.name}</h2>
			</div>

			{/* Main Navigation */}
			<nav aria-label={t("nav.main")} className={cn("flex-1 space-y-1 overflow-y-auto", expanded ? "p-3" : "p-1.5 lg:p-3")}>
				{navigation.map((item) => (
					<NavigationItem key={item.path} item={item} expanded={expanded} onNavigate={onNavigate} />
				))}
			</nav>

			{/* Bottom Navigation */}
			<nav className={cn("space-y-1 border-t", expanded ? "p-3" : "p-1.5 lg:p-3")}>
				{bottomNavigation.map((item) => (
					<NavigationItem key={item.path} item={item} expanded={expanded} onNavigate={onNavigate} />
				))}
			</nav>
		</aside>
	);
}
