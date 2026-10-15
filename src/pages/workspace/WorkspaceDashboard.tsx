import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { ArrowUpRight, FilePlus, FileText, FolderOpen, ListTodo, StickyNote, Upload, UsersRound, Calendar, AnimateIcon } from "@/components/animate-icons";

import Avatar from "@/components/elements/Avatar";
import { Page, PageBody, Panel } from "@/components/layout/Page";
import Toolbar, { ToolbarTitle } from "@/components/layout/Toolbar";
import Art from "@/components/elements/Art";
import { formatAction } from "@/lib/insights";
import { readRecent } from "@/lib/recentFiles";
import { getTasks, loadConfig } from "@/lib/tauri";
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
export default function WorkspaceDashboard() {
	const { workspace, metadata, stats, refreshMetadata, refreshStats } = useWorkspace();
	const { peers, nameOf } = useP2P();
	const navigate = useNavigate();
	const [tasks, setTasks] = useState<Task[]>([]);
	const [me, setMe] = useState("");

	useEffect(() => {
		void refreshMetadata();
		void refreshStats();
		loadConfig().then((c) => setMe(c.display_name.trim())).catch(() => {});
	}, [refreshMetadata, refreshStats]);

	useEffect(() => {
		if (!workspace) return;
		getTasks(workspace.path).then(setTasks).catch(() => setTasks([]));
	}, [workspace]);

	const activity = metadata?.activity.events ?? [];
	// Files opened in the Editor or Notes on this device, newest first
	const recent = useMemo(() => (workspace ? readRecent(workspace.path) : []), [workspace]);
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

	return (
		<Page>
			<Toolbar>
				<ToolbarTitle name={workspace?.name ?? "Dashboard"} />
				{workspace?.description && <span className="ml-1 hidden min-w-0 flex-1 truncate border-l pl-3 text-sm text-muted-foreground md:block">{workspace.description}</span>}
			</Toolbar>

			{/* A bento grid: tile size follows importance, with where to continue largest */}
			<PageBody className="grid content-start gap-4 md:grid-cols-6 xl:grid-cols-12">
				<Panel index="01" title="Pick Up Where You Left Off" flush={recent.length > 0} className="md:col-span-6 xl:col-span-5 xl:row-span-2">
					{recent.length === 0 ? (
						<div className="flex h-full flex-col items-center justify-center gap-4 py-6 text-center">
							<Art name="recent" className="h-40 w-64 max-w-full" />
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

				<Tile index="02" title="Open Tasks" value={open.length} onClick={goTo("/workspace/tasks")} className="md:col-span-3 xl:col-span-4">
					<span className="block h-2 bg-muted" role="img" aria-label={`${doneShare}% of tasks done`}>
						<span className="block h-full bg-success" style={{ width: `${doneShare}%` }} />
					</span>
					<span className="text-sm text-muted-foreground">
						{tasks.length === 0 ? "No tasks yet" : `${doneShare}% of ${tasks.length} done`}
						{late > 0 && <span className="text-destructive"> · {late} overdue</span>}
					</span>
				</Tile>
				<Tile index="03" title="Files" value={stats?.files ?? 0} onClick={goTo("/workspace/files")} className="md:col-span-3 xl:col-span-3">
					<span className="text-sm text-muted-foreground">
						{stats?.assets ?? 0} assets · {stats?.kanban_cards ?? 0} cards
					</span>
				</Tile>

				<Panel index="04" title="Due Soon" flush={due.length > 0} className="md:col-span-3 xl:col-span-4">
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

				<Panel index="05" title="People" hint={`${[...online].filter((n) => members.some((m) => m.name === n)).length} online`} flush className="md:col-span-3 xl:col-span-3">
					<ul className="divide-y">
						{members.slice(0, 4).map((m) => {
							const here = online.has(m.name);
							return (
								<li key={m.id} className="flex items-center gap-3 px-4 py-3">
									<span className="relative">
										<Avatar name={m.name} className={cn("size-8", !here && "opacity-50")} />
										<span className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 ring-2 ring-background", here ? "bg-success" : "bg-muted-foreground/50")} />
									</span>
									<span className={cn("min-w-0 flex-1 truncate text-sm font-medium", !here && "text-muted-foreground")}>{m.name}</span>
									<span className="font-mono text-[13px] text-muted-foreground">{m.role.toLowerCase()}</span>
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

				<Panel index="06" title="Activity" flush={activity.length > 0} className="md:col-span-6 xl:col-span-8">
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

				<Tile index="07" title="Kanban Cards" value={stats?.kanban_cards ?? 0} onClick={goTo("/workspace/kanban")} className="md:col-span-6 xl:col-span-4">
					<span className="text-sm text-muted-foreground">{members.length} {members.length === 1 ? "member" : "members"} share this board</span>
				</Tile>
			</PageBody>
		</Page>
	);
}

// A number worth a glance with a line of context under it. The header is the same as a panel's (number, title); the arrow says
// the whole tile opens its page.
function Tile({ index, title, value, onClick, className, children }: { index: string; title: string; value: number; onClick: () => void; className?: string; children?: ReactNode }) {
	return (
		<button type="button" onClick={onClick} className={cn("frame flex min-w-0 flex-col overflow-hidden bg-muted/40 text-left transition-colors hover:bg-muted focus-visible:bg-muted", className)}>
			<span className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
				<span className="font-mono text-[13px] text-primary" aria-hidden>
					{index}
				</span>
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
