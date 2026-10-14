// React
import { AnimateIcon, Code2, Files, FolderClose, FolderTree, ListTodo, StickyNote } from "@/components/animate-icons";
import { useCallback, useState, type ElementType } from "react";

// React Router
import { NavLink, useNavigate } from "react-router-dom";

// Icons
import { ArrowLeft, ChartColumn as BarChart3, SquareKanban as KanbanSquare, LayoutDashboard, ChevronDown, Trash2, UsersRound } from "@/components/animate-icons";

// Components
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import Splitter from "@/components/elements/Splitter";
import { usePanelSize } from "@/hooks/usePanelSize";
import { cn } from "@/lib/utils";
import Avatar from "@/components/elements/Avatar";
import { myName } from "@/lib/p2p/selfName";
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
];

// The main list in Discord-style categories: the first group has no label
const byPath = (path: string) => navigation.find((item) => item.path === path)!;
// Where things are: the dashboard and the explorer for everything sit at the top, then the places to write, the stored
// items, then planning
const navGroups: { id: string; label?: MessageKey; items: NavigationItem[] }[] = [
	{ id: "top", items: [byPath("/workspace"), byPath("/workspace/explorer")] },
	{ id: "write", label: "nav.groupWrite", items: [byPath("/workspace/notes"), byPath("/workspace/editor")] },
	{ id: "storage", label: "nav.groupStorage", items: [byPath("/workspace/files"), byPath("/workspace/assets")] },
	{ id: "plan", label: "nav.groupPlan", items: [byPath("/workspace/tasks"), byPath("/workspace/kanban")] },
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
		name: "Insights",
		label: "nav.insights",
		path: "/workspace/insights",
		icon: BarChart3,
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

// Dragging the edge narrower than this folds the sidebar to its icons; dragging it wider opens it again
// Wide enough that a rail icon sits exactly where it does when the sidebar is open (12px nav padding + 12px item padding each side)
const RAIL = 68;
const COLLAPSE_BELOW = 150;
const MIN_OPEN = 200;

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
						"relative flex w-full items-center gap-3 overflow-hidden rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
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
// The bottom card of the sidebar, like a chat app's: your avatar, name and role
function UserCard({ showLabels }: { showLabels: boolean }) {
	const { workspace, metadata } = useWorkspace();
	const members = metadata?.members.members ?? [];
	const name = myName(workspace?.id, members.find((m) => m.role === "Owner")?.name);
	const role = members.find((m) => m.name === name)?.role;
	return (
		<div className={cn("m-3 flex items-center gap-3", showLabels ? "rounded-lg bg-muted/40 p-2" : "ml-[14px]")}>
			<Avatar name={name} className="size-10 text-sm" />
			{showLabels && (
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-semibold">{name}</span>
					{role && <span className="block truncate font-mono text-[13px] text-muted-foreground">{role.toLowerCase()}</span>}
				</span>
			)}
		</div>
	);
}

// `expanded` is the drawer on small windows: full width with labels, and `onNavigate` closes it after a choice
export default function WorkspaceSidebar({ expanded = false, onNavigate }: { expanded?: boolean; onNavigate?: () => void }) {
	const { workspace, clearWorkspace } = useWorkspace();
	const navigate = useNavigate();
	// How wide the sidebar is when open, remembered on this device; groups with a label can be folded away
	const [width, setWidth] = usePanelSize("sidebar", DEFAULT_WIDTH, RAIL, 380);
	// The drag decides it: a narrow sidebar is the icon rail, a wider one is at least MIN_OPEN
	const collapsed = !expanded && width < COLLAPSE_BELOW;
	const shownWidth = collapsed ? RAIL : Math.max(width, MIN_OPEN);
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
	// Unload workspace and return to Welcome view
	const handleBackToWelcome = async () => {
		await clearWorkspace();
		navigate("/");
	};

	return (
		<div className="relative flex h-full shrink-0">
		<aside
			style={!expanded ? { width: shownWidth } : undefined}
			className={cn("flex h-full shrink-0 flex-col overflow-hidden bg-sidebar", expanded && "w-64 border-r")}
		>
			{/* Workspace identity */}
			<div className={cn("flex h-12 shrink-0 items-center gap-2", "justify-start pl-[14px]")}>
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
			<nav aria-label={t("nav.main")} className={cn("flex flex-1 flex-col overflow-y-auto overflow-x-hidden", showLabels ? "gap-4 p-3" : "gap-2 p-3")}>
				{navGroups.map((group, i) => {
					const open = !group.label || !showLabels || !folded.includes(group.id);
					return (
						<div key={group.id} className={cn("flex flex-col gap-0.5", !showLabels && i > 0 && "pt-2")}>
							{group.label && showLabels && (
								<button
									type="button"
									aria-expanded={open}
									onClick={() => toggleGroup(group.id)}
									className="flex items-center gap-2 px-3 pb-1 text-left font-mono text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
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
			<nav className="flex flex-col gap-1 p-3">
				{bottomNavigation.map((item) => (
					<NavigationItem key={item.path} item={item} expanded={showLabels} onNavigate={onNavigate} />
				))}
			</nav>

			{/* You: who this device is in the workspace */}
			<UserCard showLabels={showLabels} />
		</aside>

			{/* The sidebar edge: drag it to change the width, narrow enough and it folds to icons; double-click to reset */}
			{!expanded && <Splitter orientation="vertical" grows="right" size={shownWidth} onResize={(next) => setWidth(next === 0 ? DEFAULT_WIDTH : next)} label="Resize the sidebar" className="bg-transparent" quiet />}
		</div>
	);
}
