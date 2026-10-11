// React
import { AnimateIcon, Code2, Files, FolderClose, FolderTree, ListTodo, StickyNote } from "@/components/animate-icons";
import { useCallback, useState, type ElementType } from "react";

// React Router
import { NavLink, useNavigate } from "react-router-dom";

// Icons
import { ArrowLeft, ChartColumn as BarChart3, SquareKanban as KanbanSquare, LayoutDashboard, ChevronDown, ChevronLeft, ChevronRight, Trash2, UsersRound } from "@/components/animate-icons";

// Components
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import Splitter from "@/components/elements/Splitter";
import { usePanelSize } from "@/hooks/usePanelSize";
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
		name: "Explorer",
		label: "nav.explorer",
		path: "/workspace/explorer",
		icon: FolderTree,
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
		icon: FolderClose,
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

// The main list in Discord-style categories: the first group has no label
const byPath = (path: string) => navigation.find((item) => item.path === path)!;
// Where things are: the dashboard and the explorer for everything sit at the top, then the places to write, the stored
// items, then planning
const navGroups: { id: string; label?: MessageKey; items: NavigationItem[] }[] = [
	{ id: "top", items: [byPath("/workspace"), byPath("/workspace/explorer")] },
	{ id: "write", label: "nav.groupWrite", items: [byPath("/workspace/notes"), byPath("/workspace/editor")] },
	{ id: "storage", label: "nav.groupStorage", items: [byPath("/workspace/files"), byPath("/workspace/assets")] },
	{ id: "plan", label: "nav.groupPlan", items: [byPath("/workspace/tasks"), byPath("/workspace/kanban"), byPath("/workspace/insights")] },
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

const FOLDED_KEY = "nexsync.sidebar.folded";
const DEFAULT_WIDTH = 256;
const readFolded = (): string[] => {
	try {
		const list = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]");
		return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
};

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
						"relative flex w-full items-center gap-3 overflow-hidden rounded-none px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
						expanded ? "justify-start" : "justify-center",
						isActive ? "bg-primary/10 text-primary before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:bg-primary" : "text-foreground hover:bg-muted",
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
	// How wide the sidebar is when open, remembered on this device; groups with a label can be folded away
	const [width, setWidth] = usePanelSize("sidebar", DEFAULT_WIDTH, 200, 380);
	const [folded, setFolded] = useState(readFolded);
	const toggleGroup = useCallback((id: string) => {
		setFolded((prev) => {
			const next = prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id];
			try {
				localStorage.setItem(FOLDED_KEY, JSON.stringify(next));
			} catch {
				// Not remembered this time
			}
			return next;
		});
	}, []);
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
		<aside
			style={!expanded && !collapsed ? { width } : undefined}
			className={cn("flex h-full shrink-0 flex-col overflow-hidden bg-muted/20 transition-[width] duration-200 motion-reduce:transition-none", expanded ? "w-64 border-r bg-background" : collapsed ? "w-[4.5rem]" : "")}
		>
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

				<p className={cn("truncate font-semibold whitespace-nowrap", showLabels ? "block" : "hidden")}>{workspace?.name}</p>
			</div>

			{/* Main Navigation */}
			<nav aria-label={t("nav.main")} className={cn("flex flex-1 flex-col overflow-y-auto overflow-x-hidden", showLabels ? "gap-4 p-3" : "gap-2 p-2")}>
				{navGroups.map((group, i) => {
					const open = !group.label || !showLabels || !folded.includes(group.id);
					return (
						<div key={group.id} className={cn("flex flex-col gap-0.5", !showLabels && i > 0 && "border-t pt-2")}>
							{group.label && showLabels && (
								<button
									type="button"
									aria-expanded={open}
									onClick={() => toggleGroup(group.id)}
									className="flex items-center gap-1.5 px-3 pb-1 text-left font-mono text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
								>
									<ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} aria-hidden />
									{t(group.label)}
								</button>
							)}
							{open && group.items.map((item) => <NavigationItem key={item.path} item={item} expanded={showLabels} onNavigate={onNavigate} />)}
						</div>
					);
				})}
			</nav>

			{/* Bottom Navigation */}
			<nav className={cn("flex flex-col gap-1 border-t", showLabels ? "p-3" : "p-2")}>
				{bottomNavigation.map((item) => (
					<NavigationItem key={item.path} item={item} expanded={showLabels} onNavigate={onNavigate} />
				))}
			</nav>
		</aside>

			{/* The sidebar edge: drag it to change the width, double-click to reset */}
			{expanded ? null : collapsed ? <div className="w-px shrink-0 bg-border" /> : <Splitter orientation="vertical" grows="right" size={width} onResize={(next) => setWidth(next === 0 ? DEFAULT_WIDTH : next)} label="Resize the sidebar" />}

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
