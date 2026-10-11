import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { FilePlus, FileText, FolderOpen, ListTodo, StickyNote, Upload, UsersRound, Calendar, AnimateIcon } from "@/components/animate-icons";

import Avatar from "@/components/elements/Avatar";
import { Page, PageBody, Panel } from "@/components/layout/Page";
import Toolbar, { ToolbarTitle } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
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

// "note_created" becomes "Note created"
const formatAction = (action: string) => {
	const s = action.replace(/_/g, " ").trim();
	return s.charAt(0).toUpperCase() + s.slice(1);
};

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
const openPath = (file: string) => `/workspace/${/\.(md|txt)$/i.test(file) ? "notes" : "editor"}?open=${encodeURIComponent(file)}`;

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
	const recent = metadata?.history.recent_files ?? [];
	const members = metadata?.members.members ?? [];
	const online = useMemo(() => new Set([me, ...peers.filter((p) => p.status === "connected").map((p) => nameOf(p.id))]), [me, peers, nameOf]);
	const due = useMemo(
		() => tasks.filter((t) => t.status !== "done" && t.due_date).sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1)).slice(0, 5),
		[tasks],
	);
	const today = new Date().toISOString().slice(0, 10);

	const counts: [string, number, string][] = [
		["files", stats?.files ?? 0, "/workspace/files"],
		["assets", stats?.assets ?? 0, "/workspace/assets"],
		["tasks", stats?.tasks ?? 0, "/workspace/tasks"],
		["cards", stats?.kanban_cards ?? 0, "/workspace/kanban"],
		["members", stats?.members ?? 0, "/workspace/members"],
	];

	return (
		<Page>
			<Toolbar>
				<ToolbarTitle name={workspace?.name ?? "dashboard"} meta={workspace?.description} />
				<span className="flex-1" />
				<Button variant="outline" size="sm" onPress={() => navigate("/workspace/notes")}><StickyNote className="size-4" />Notes</Button>
				<Button variant="outline" size="sm" onPress={() => navigate("/workspace/tasks")}><ListTodo className="size-4" />Tasks</Button>
				<Button variant="outline" size="sm" onPress={() => navigate("/workspace/files")}><FilePlus className="size-4" />Files</Button>
			</Toolbar>

			<PageBody className="grid content-start gap-3 xl:grid-cols-[minmax(0,1fr)_24rem]">
				<dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:col-span-2">
					{counts.map(([label, value, path]) => (
						<button key={label} type="button" onClick={() => navigate(path)} className="border bg-card/40 p-4 text-left outline-none transition-colors hover:border-primary focus-visible:border-primary">
							<dd className="font-mono text-3xl font-semibold tabular-nums">{value}</dd>
							<dt className="text-sm text-muted-foreground">{label}</dt>
						</button>
					))}
				</dl>

				<div className="flex min-w-0 flex-col gap-3">
					<Panel title="pick up where you left off" hint={recent.length ? `${Math.min(recent.length, 5)} recent` : undefined} flush={recent.length > 0}>
						{recent.length === 0 ? (
							<p className="text-sm text-muted-foreground">Files you open show up here, so you can jump back in.</p>
						) : (
							<ul className="divide-y">
								{recent.slice(0, 5).map((file) => (
									<li key={file}>
										<AnimateIcon animateOnHover asChild>
											<button type="button" onClick={() => navigate(openPath(file))} className="flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted">
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

					<Panel title="activity" hint="The latest changes" flush={activity.length > 0}>
						{activity.length === 0 ? (
							<p className="text-sm text-muted-foreground">Nothing has changed yet. Create a note, file or task to get started.</p>
						) : (
							<ul className="divide-y">
								{activity.slice(0, 8).map((event) => {
									const Icon = eventIcon(event.target_type, event.action);
									return (
										<li key={event.id} className="flex items-center gap-3 px-4 py-2.5">
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
				</div>

				<aside className="flex flex-col gap-3">
					<Panel title="people" hint={`${[...online].filter((n) => members.some((m) => m.name === n)).length} online`} flush>
						<ul className="divide-y">
							{members.map((m) => {
								const here = online.has(m.name);
								return (
									<li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
										<span className="relative">
											<Avatar name={m.name} className={cn("size-8", !here && "opacity-50")} />
											<span className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 ring-2 ring-card", here ? "bg-success" : "bg-muted-foreground/50")} />
										</span>
										<span className="min-w-0 flex-1">
											<span className={cn("block truncate text-sm font-medium", !here && "text-muted-foreground")}>{m.name}</span>
										</span>
										<span className="font-mono text-[13px] text-muted-foreground">{m.role.toLowerCase()}</span>
									</li>
								);
							})}
						</ul>
					</Panel>

					<Panel title="due soon" flush={due.length > 0}>
						{due.length === 0 ? (
							<p className="text-sm text-muted-foreground">No dates set. Give a task a due date and it appears here.</p>
						) : (
							<ul className="divide-y">
								{due.map((task) => {
									const late = task.due_date! < today;
									return (
										<li key={task.id}>
											<AnimateIcon animateOnHover asChild>
												<button type="button" onClick={() => navigate(`/workspace/tasks?open=${encodeURIComponent(task.id)}`)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted">
													<span className="truncate font-medium">{task.title}</span>
													<span className={cn("flex shrink-0 items-center gap-1.5 font-mono text-[13px] tabular-nums", late ? "text-destructive" : task.due_date === today ? "text-warning" : "text-muted-foreground")}>
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
				</aside>
			</PageBody>
		</Page>
	);
}
