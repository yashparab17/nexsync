import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { ArrowUpRight, Check, EyeOff, FilePlus, FileText, FolderOpen, ListTodo, Plus, RotateCcw, SlidersHorizontal, StickyNote, Upload, UsersRound, Calendar, AnimateIcon } from "@/components/animate-icons";

import Avatar from "@/components/elements/Avatar";
import AnnouncementStrip from "@/features/announcements/components/AnnouncementStrip";
import { Button } from "@/components/ui/button";
import { Page, PageBody, Panel } from "@/components/layout/Page";
import Toolbar, { ToolbarTitle } from "@/components/layout/Toolbar";
import Art from "@/components/elements/Art";
import { DEFAULT_LAYOUT, loadLayout, moveTile, saveLayout, type DashboardLayout, type TileId, type TileSize } from "@/lib/dashboardLayout";
import { readHideEdits, saveHideEdits, visibleEvents } from "@/lib/activityFeed";
import { formatAction } from "@/lib/insights";
import { useRecent } from "@/lib/recentFiles";
import { useRuns } from "@/features/projects/lib/projectRuns";
import { getTasks, loadConfig, projectRuns, projectsList } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { Task } from "@/types/workspace";

// "5m ago" from an ISO timestamp
function formatRelative(iso: string): string {
	if (!iso) return "";
	const mins = Math.floor(Math.max(0, Date.now() - new Date(iso).getTime()) / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

// The icon for what an event touched; neutral, so colour is saved for what needs attention
function eventIcon(targetType?: string, action?: string) {
	const key = `${targetType ?? ""} ${action ?? ""}`.toLowerCase();
	if (key.includes("note")) return StickyNote;
	if (key.includes("asset")) return Upload;
	if (key.includes("task") || key.includes("card") || key.includes("column")) return ListTodo;
	if (key.includes("folder")) return FolderOpen;
	if (key.includes("member")) return UsersRound;
	return FilePlus;
}

// Notes open in the notes page, everything else in the code editor
const openPath = (file: string) => `/workspace/${/\.(md|txt)$/i.test(file) ? "notes" : "editor"}?open=${encodeURIComponent(`/${file.replace(/^\/+/, "")}`)}`;

// Workspace overview: where to continue, who is here, what is due, what changed
export default function DashboardPage() {
	const { workspace, metadata, stats, refreshMetadata, refreshStats } = useWorkspace();
	const { peers, nameOf } = useP2P();
	const navigate = useNavigate();
	const [tasks, setTasks] = useState<Task[]>([]);
	const [me, setMe] = useState("");
	// How many projects there are, and how the last test run of each went on this device
	const [projectStats, setProjectStats] = useState<{ count: number; passing: number; failing: number }>({ count: 0, passing: 0, failing: 0 });
	const liveRuns = useRuns();
	const runningNow = liveRuns.filter((r) => r.status !== "done").length;
	const finishedRuns = liveRuns.filter((r) => r.status === "done").length;
	// The tiles the person chose to show, in their order and size; remembered per workspace
	const [layout, setLayout] = useState<DashboardLayout>(() => loadLayout(workspace?.id ?? ""));
	const [editing, setEditing] = useState(false);
	const [dragging, setDragging] = useState<TileId | null>(null);
	useEffect(() => setLayout(loadLayout(workspace?.id ?? "")), [workspace?.id]);
	const change = (next: DashboardLayout) => {
		setLayout(next);
		saveLayout(workspace?.id ?? "", next);
	};

	useEffect(() => {
		void refreshMetadata();
		void refreshStats();
		loadConfig().then((c) => setMe(c.display_name.trim())).catch(() => {});
	}, [refreshMetadata, refreshStats]);

	useEffect(() => {
		if (!workspace) return;
		getTasks(workspace.path).then(setTasks).catch(() => setTasks([]));
	}, [workspace]);

	useEffect(() => {
		if (!workspace) return;
		let live = true;
		void (async () => {
			const list = ((await projectsList(workspace.path).catch(() => [])) ?? []).filter((p) => !p.scratch);
			let passing = 0;
			let failing = 0;
			for (const p of list) {
				const last = (await projectRuns(workspace.path, p.id).catch(() => [])).find((r) => /test/i.test(r.task) && !r.stopped);
				if (last) last.code === 0 ? passing++ : failing++;
			}
			if (live) setProjectStats({ count: list.length, passing, failing });
		})();
		return () => {
			live = false;
		};
		// A run that ends changes the answer
	}, [workspace, finishedRuns]);

	// Saves while someone writes are many lines; each person can hide them from their own feed
	const [hideEdits, setHideEdits] = useState(readHideEdits);
	const activity = visibleEvents(metadata?.activity.events ?? [], hideEdits);
	// Files opened in the Editor or Notes on this device, newest first
	const recent = useRecent(workspace?.path);
	const members = metadata?.members.members ?? [];
	const online = useMemo(() => new Set([me, ...peers.filter((p) => p.status === "connected").map((p) => nameOf(p.id))]), [me, peers, nameOf]);
	const due = useMemo(
		() => tasks.filter((t) => t.status !== "done" && t.due_date).sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1)).slice(0, 5),
		[tasks],
	);
	const today = new Date().toISOString().slice(0, 10);

	const open = tasks.filter((t) => t.status !== "done");
	const doneShare = tasks.length ? Math.round(((tasks.length - open.length) / tasks.length) * 100) : 0;
	const late = open.filter((t) => t.due_date && t.due_date < today).length;
	const goTo = (path: string) => () => navigate(path);

	const tiles: Record<TileId, ReactNode> = {
		pickup: (
				<Panel title="Pick Up Where You Left Off" flush={recent.length > 0} className="h-full">
					{recent.length === 0 ? (
						<div className="flex h-full flex-col items-center justify-center gap-4 py-6 text-center">
							<Art name="welcome-back" className="h-40 w-64 max-w-full" />
							<p className="text-sm text-muted-foreground">Files you open show up here, so you can jump back in.</p>
						</div>
					) : (
						<ul className="divide-y">
							{recent.slice(0, 6).map((file) => (
								<li key={file}>
									<AnimateIcon animateOnHover asChild>
										<button type="button" onClick={() => navigate(openPath(file))} className="flex w-full items-center gap-3 px-4 py-4 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted">
											<FileText className="size-5 shrink-0 text-muted-foreground" />
											<span className="min-w-0">
												<span className="block truncate text-sm font-medium">{file.split("/").pop()}</span>
												<span className="block truncate font-mono text-[13px] text-muted-foreground">{file}</span>
											</span>
										</button>
									</AnimateIcon>
								</li>
							))}
						</ul>
					)}
				</Panel>
		),
		tasks: (
				<Tile title="Open Tasks" value={open.length} onClick={goTo("/workspace/tasks")} className="h-full">
					<span className="block h-2 bg-muted" role="img" aria-label={`${doneShare}% of tasks done`}>
						<span className="block h-full bg-success" style={{ width: `${doneShare}%` }} />
					</span>
					<span className="text-sm text-muted-foreground">
						{tasks.length === 0 ? "No tasks yet" : `${doneShare}% of ${tasks.length} done`}
						{late > 0 && <span className="text-destructive"> · {late} overdue</span>}
					</span>
				</Tile>
		),
		files: (
				<Tile title="Files" value={stats?.files ?? 0} onClick={goTo("/workspace/explorer")} className="h-full">
					<span className="text-sm text-muted-foreground">
						{stats?.assets ?? 0} assets · {stats?.kanban_cards ?? 0} cards
					</span>
				</Tile>
		),
		due: (
				<Panel title="Due Soon" flush={due.length > 0} className="h-full">
					{due.length === 0 ? (
						<p className="text-sm text-muted-foreground">No dates set. Give a task a due date and it appears here.</p>
					) : (
						<ul className="divide-y">
							{due.slice(0, 4).map((task) => {
								const overdue = task.due_date! < today;
								return (
									<li key={task.id}>
										<AnimateIcon animateOnHover asChild>
											<button type="button" onClick={() => navigate(`/workspace/tasks?open=${encodeURIComponent(task.id)}`)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted">
												<span className="truncate font-medium">{task.title}</span>
												<span className={cn("flex shrink-0 items-center gap-2 font-mono text-[13px] tabular-nums", overdue ? "text-destructive" : task.due_date === today ? "text-warning" : "text-muted-foreground")}>
													<Calendar className="size-3.5" />
													{task.due_date === today ? "today" : task.due_date}
												</span>
											</button>
										</AnimateIcon>
									</li>
								);
							})}
						</ul>
					)}
				</Panel>
		),
		people: (
				<Panel title="People" hint={`${[...online].filter((n) => members.some((m) => m.name === n)).length} online`} flush className="h-full">
					<ul className="divide-y">
						{members.slice(0, 4).map((m) => {
							const here = online.has(m.name);
							return (
								<li key={m.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
									<Avatar name={m.name} className={cn("size-8", !here && "opacity-50")} />
									<span className="min-w-0 flex-1">
										<span className={cn("block truncate text-sm font-medium", !here && "text-muted-foreground")}>{m.name}</span>
										<span className="block truncate font-mono text-[13px] text-muted-foreground">{m.role.toLowerCase()}</span>
									</span>
									<span title={here ? "Online" : "Offline"} aria-label={here ? "Online" : "Offline"} className={cn("size-2 shrink-0 rounded-full", here ? "bg-success" : "bg-muted-foreground/40")} />
								</li>
							);
						})}
						{members.length > 4 && (
							<li>
								<button type="button" onClick={goTo("/workspace/members")} className="w-full px-4 py-3 text-left text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted">
									and {members.length - 4} more
								</button>
							</li>
						)}
					</ul>
				</Panel>
		),
		activity: (
				<Panel
					title="Activity"
					flush={activity.length > 0}
					className="h-full"
					right={
						<Button
							size="sm"
							variant="ghost"
							aria-pressed={hideEdits}
							onPress={() => {
								saveHideEdits(!hideEdits);
								setHideEdits(!hideEdits);
							}}
						>
							{hideEdits ? "Show edits" : "Hide edits"}
						</Button>
					}
				>
					{activity.length === 0 ? (
						<p className="text-sm text-muted-foreground">Nothing has changed yet. Create a note, file or task to get started.</p>
					) : (
						<ul className="divide-y">
							{activity.slice(0, 6).map((event) => {
								const Icon = eventIcon(event.target_type, event.action);
								return (
									<li key={event.id} className="flex items-center gap-3 px-4 py-3">
										{event.author ? <Avatar name={event.author} className="size-7 text-xs" /> : <span className="flex size-7 shrink-0 items-center justify-center bg-muted text-muted-foreground"><Icon className="size-4" /></span>}
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm">
												<span className="font-medium">{event.author ?? formatAction(event.action)}</span>
												{event.author && <span className="text-muted-foreground"> {formatAction(event.action).toLowerCase()}</span>}
											</p>
											<p className="truncate text-sm text-muted-foreground">{event.detail}</p>
										</div>
										<span className="shrink-0 font-mono text-[13px] tabular-nums text-muted-foreground">{formatRelative(event.timestamp)}</span>
									</li>
								);
							})}
						</ul>
					)}
				</Panel>
		),
		projects: (
			<Tile title="Projects" value={projectStats.count} onClick={goTo("/workspace/projects")} className="h-full">
				<span className="text-sm text-muted-foreground">
					{runningNow > 0 ? `${runningNow} running · ` : ""}
					{projectStats.passing + projectStats.failing === 0 ? "No test runs on this device yet" : `Tests: ${projectStats.passing} passing`}
					{projectStats.failing > 0 && <span className="text-destructive"> · {projectStats.failing} failing</span>}
				</span>
			</Tile>
		),
		cards: (
				<Tile title="Kanban Cards" value={stats?.kanban_cards ?? 0} onClick={goTo("/workspace/kanban")} className="h-full">
					<span className="text-sm text-muted-foreground">{members.length} {members.length === 1 ? "member" : "members"} share this board</span>
				</Tile>
		),
	};

	return (
		<Page>
			<Toolbar>
				<ToolbarTitle name={workspace?.name ?? "Dashboard"} />
				{workspace?.description && <span className="ml-1 hidden min-w-0 flex-1 truncate border-l pl-3 text-sm text-muted-foreground md:block">{workspace.description}</span>}
				<span className="flex-1" />
				<Button variant={editing ? "default" : "ghost"} size="sm" onPress={() => setEditing((v) => !v)}>
					{editing ? <Check className="size-4" /> : <SlidersHorizontal className="size-4" />}
					{editing ? "Done" : "Customize"}
				</Button>
			</Toolbar>

			{/* A bento grid: tile size follows importance, with where to continue largest */}
			<PageBody className="@container">
				{editing && (
					<div className="mb-4 flex flex-wrap items-center gap-2 bg-muted/40 p-3 text-sm text-muted-foreground">
						<span className="mr-auto">Drag a tile to move it. Pick a size, or hide it.</span>
						{layout.hidden.map((id) => (
							<Button key={id} variant="outline" size="sm" onPress={() => change({ ...layout, hidden: layout.hidden.filter((h) => h !== id) })}>
								<Plus className="size-3.5" />
								{TITLES[id]}
							</Button>
						))}
						<Button variant="ghost" size="sm" onPress={() => change(DEFAULT_LAYOUT)}>
							<RotateCcw className="size-3.5" />
							Reset
						</Button>
					</div>
				)}
				<div className="flex flex-wrap content-start gap-4">
				<div className="w-full empty:hidden">
						<AnnouncementStrip />
					</div>
					<AnimatePresence initial={false}>
						{layout.order
							.filter((id) => !layout.hidden.includes(id))
							.map((id) => (
								<DashTile key={id} id={id} size={layout.size[id]} editing={editing} onSize={(size) => change({ ...layout, size: { ...layout.size, [id]: size } })} onHide={() => change({ ...layout, hidden: [...layout.hidden, id] })} onDragStart={() => setDragging(id)} onDragOver={() => dragging && dragging !== id && change({ ...layout, order: moveTile(layout.order, dragging, id) })} onDragEnd={() => setDragging(null)} dragging={dragging === id}>
									{tiles[id]}
								</DashTile>
							))}
					</AnimatePresence>
				</div>
			</PageBody>
		</Page>
	);
}

const TITLES: Record<TileId, string> = { pickup: "Pick Up Where You Left Off", tasks: "Open Tasks", files: "Files", due: "Due Soon", people: "People", activity: "Activity", cards: "Kanban Cards", projects: "Projects" };

// Where each size starts from at the narrow, medium and wide container widths; every tile then grows to share what is left of its row
const SPAN: Record<TileSize, string> = {
	s: "@xl:basis-[calc(50%-0.5rem)] @4xl:basis-[calc(33.333%-0.75rem)]",
	m: "@xl:basis-full @4xl:basis-[calc(50%-0.5rem)]",
	l: "basis-full",
};

// One tile of the grid. Moving or resizing the others glides it to its new place; while customizing it can be dragged to a new spot
// and shows its size and hide buttons over it.
function DashTile({ id, size, editing, dragging, onSize, onHide, onDragStart, onDragOver, onDragEnd, children }: { id: TileId; size: TileSize; editing: boolean; dragging: boolean; onSize: (size: TileSize) => void; onHide: () => void; onDragStart: () => void; onDragOver: () => void; onDragEnd: () => void; children: ReactNode }) {
	return (
		<motion.div layout="position" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: dragging ? 0.5 : 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ type: "spring", stiffness: 420, damping: 38 }} className={cn("relative flex min-w-0 grow basis-full", SPAN[size])}>
			<div inert={editing} className="flex w-full min-w-0 [&>*]:flex-1">
				{children}
			</div>
			{editing && (
				<div
					draggable
					onDragStart={(e) => {
						e.dataTransfer.effectAllowed = "move";
						onDragStart();
					}}
					onDragOver={(e) => {
						e.preventDefault();
						onDragOver();
					}}
					onDragEnd={onDragEnd}
					className="absolute inset-0 z-10 flex cursor-grab items-start justify-end gap-1 bg-background/70 p-2 backdrop-blur-[1px] active:cursor-grabbing"
				>
					<span className="flex-1" />
					{(["s", "m", "l"] as const).map((v) => (
						<Button key={v} variant={size === v ? "default" : "ghost"} size="icon-sm" aria-label={`${TITLES[id]}: ${v === "s" ? "Small" : v === "m" ? "Medium" : "Large"}`} onPress={() => onSize(v)}>
							{v.toUpperCase()}
						</Button>
					))}
					<Button variant="ghost" size="icon-sm" aria-label={`Hide ${TITLES[id]}`} onPress={onHide}>
						<EyeOff className="size-4" />
					</Button>
				</div>
			)}
		</motion.div>
	);
}

// A number worth a glance with a line of context under it. The header is the same as a panel's (number, title); the arrow says
// the whole tile opens its page.
function Tile({ title, value, onClick, className, children }: { title: string; value: number; onClick: () => void; className?: string; children?: ReactNode }) {
	return (
		<button type="button" onClick={onClick} className={cn("frame flex min-w-0 flex-col overflow-hidden bg-muted/40 text-left transition-colors hover:bg-muted focus-visible:bg-muted", className)}>
			<span className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
				<span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
				<ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
			</span>
			<span className="flex flex-1 flex-col justify-between gap-4 p-4">
				<span className="text-4xl font-semibold tabular-nums">{value}</span>
				<span className="flex flex-col gap-2">{children}</span>
			</span>
		</button>
	);
}
