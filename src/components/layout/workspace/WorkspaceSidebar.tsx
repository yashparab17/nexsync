// React
import { AnimateIcon } from "@/components/animate-icons";
import { useState, type ElementType } from "react";

// React Router
import { NavLink, useNavigate } from "react-router-dom";

// Icons
import { Code2, Files, FolderOpen, ListTodo, StickyNote } from "lucide-react";
import { ArrowLeft, ChartColumn as BarChart3, SquareKanban as KanbanSquare, LayoutDashboard, ChevronLeft, ChevronRight, Trash2, UsersRound } from "@/components/animate-icons";

// Components
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import PresenceDots from "@/components/elements/PresenceDots";
import { pageOf } from "@/lib/p2p/presence";
import { useP2P } from "@/store/p2p/P2PContext";

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
];

const COLLAPSED_KEY = "nexsync.sidebar.collapsed";
const readCollapsed = () => {
	try {
		return localStorage.getItem(COLLAPSED_KEY) === "true";
	} catch {
		return false;
	}
};

// Sidebar navigation link component
function NavigationItem({ item, expanded, onNavigate }: { item: NavigationItem; expanded: boolean; onNavigate?: () => void }) {
	const Icon = item.icon;
	const { viewersAt } = useP2P();
	const page = pageOf(item.path);
	const [hot, setHot] = useState(false);

	return (
		<AnimateIcon animate={hot} className="contents">
			<NavLink
				to={item.path}
				end={item.end}
				onClick={onNavigate}
				onMouseEnter={() => setHot(true)}
				onMouseLeave={() => setHot(false)}
				onFocus={() => setHot(true)}
				onBlur={() => setHot(false)}
				className={({ isActive }) =>
					cn(
						"flex w-full items-center gap-3 overflow-hidden rounded-none px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
						expanded ? "justify-start" : "justify-center",
						isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
					)
				}
				title={t(item.label)}
				aria-label={t(item.label)}
			>
				<Icon className="size-5 shrink-0" aria-hidden />
				<span className={cn("whitespace-nowrap", expanded ? "inline" : "hidden")}>{t(item.label)}</span>
				{page && (
					<span className={cn("ml-auto", !expanded && "hidden")}>
						<PresenceDots names={viewersAt(page)} />
					</span>
				)}
			</NavLink>
		</AnimateIcon>
	);
}

// Left sidebar navigation bar for workspace views
// `expanded` is the drawer on small windows: full width with labels, and `onNavigate` closes it after a choice
export default function WorkspaceSidebar({ expanded = false, onNavigate }: { expanded?: boolean; onNavigate?: () => void }) {
	const { workspace, clearWorkspace } = useWorkspace();
	const navigate = useNavigate();
	const [collapsed, setCollapsed] = useState(readCollapsed);
	// The drawer on small windows always shows labels
	const showLabels = expanded || !collapsed;
	const toggle = () => {
		setCollapsed(!collapsed);
		try {
			localStorage.setItem(COLLAPSED_KEY, String(!collapsed));
		} catch {
			// Not remembered this time
		}
	};

	// Unload workspace and return to Welcome view
	const handleBackToWelcome = async () => {
		await clearWorkspace();
		navigate("/");
	};

	return (
		<div className="relative flex h-full shrink-0">
		<aside className={cn("flex h-full shrink-0 flex-col overflow-hidden border-r bg-muted/20 transition-[width] duration-200 motion-reduce:transition-none", expanded ? "w-64 bg-background" : collapsed ? "w-[4.5rem]" : "w-64")}>
			{/* Workspace identity */}
			<div className={cn("flex h-16 shrink-0 items-center gap-2 border-b", showLabels ? "justify-start px-3" : "justify-center")}>
				<Button
					variant="ghost"
					size="icon"
					onPress={handleBackToWelcome}
					aria-label="Back to welcome"
				>
					<ArrowLeft className="size-5" />
				</Button>

				<h2 className={cn("truncate font-semibold whitespace-nowrap", showLabels ? "block" : "hidden")}>{workspace?.name}</h2>
			</div>

			{/* Main Navigation */}
			<nav aria-label={t("nav.main")} className={cn("flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden", showLabels ? "p-3" : "p-2")}>
				{navigation.map((item) => (
					<NavigationItem key={item.path} item={item} expanded={showLabels} onNavigate={onNavigate} />
				))}
			</nav>

			{/* Bottom Navigation */}
			<nav className={cn("flex flex-col gap-1 border-t", showLabels ? "p-3" : "p-2")}>
				{bottomNavigation.map((item) => (
					<NavigationItem key={item.path} item={item} expanded={showLabels} onNavigate={onNavigate} />
				))}
			</nav>
		</aside>

			{/* The tab on the sidebar edge, level with the header */}
			{!expanded && (
				<AnimateIcon animateOnHover asChild>
					<button
						type="button"
						onClick={toggle}
						aria-label={t(collapsed ? "nav.expand" : "nav.collapse")}
						title={t(collapsed ? "nav.expand" : "nav.collapse")}
						className="absolute top-5 -right-3 z-10 flex size-6 items-center justify-center border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						{collapsed ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronLeft className="size-3.5" aria-hidden />}
					</button>
				</AnimateIcon>
			)}
		</div>
	);
}
