import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { FilePlus, FileText, FolderOpen, ListTodo, StickyNote, Upload, UsersRound, Calendar, AnimateIcon } from "@/components/animate-icons";

import Avatar from "@/components/elements/Avatar";
import PageHeader from "@/components/layout/PageHeader";
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

// A titled block on the dashboard
function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-baseline justify-between gap-3">
				<h2 className="text-lg font-semibold">{title}</h2>
				{aside && <span className="font-mono text-xs text-muted-foreground">{aside}</span>}
			</div>
			{children}
		</section>
	);
}

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
		<div className="flex flex-col">
			<PageHeader
				title={workspace?.name ?? "Dashboard"}
				description={workspace?.description || "Here is what changed lately."}
				actions={
					<>
						<Button variant="outline" onPress={() => navigate("/workspace/notes")}><StickyNote className="size-4" />Notes</Button>
						<Button variant="outline" onPress={() => navigate("/workspace/tasks")}><ListTodo className="size-4" />Tasks</Button>
						<Button variant="outline" onPress={() => navigate("/workspace/files")}><FilePlus className="size-4" />Files</Button>
					</>
				}
			/>

			<dl className="mb-8 flex flex-wrap gap-x-10 gap-y-2 border-y py-3">
				{counts.map(([label, value, path]) => (
					<button key={label} type="button" onClick={() => navigate(path)} className="flex items-baseline gap-2 hover:text-primary">
						<dd className="font-mono text-2xl font-bold tabular-nums">{value}</dd>
						<dt className="text-sm text-muted-foreground">{label}</dt>
					</button>
				))}
			</dl>

			<div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_24rem]">
				<div className="flex min-w-0 flex-col gap-10">
					<Section title="Pick up where you left off" aside={recent.length ? `${Math.min(recent.length, 5)} recent` : undefined}>
						{recent.length === 0 ? (
							<p className="border border-dashed p-6 text-muted-foreground">Files you open show up here, so you can jump back in.</p>
						) : (
							<ul className="divide-y border bg-card">
								{recent.slice(0, 5).map((file) => (
									<li key={file}>
										<AnimateIcon animateOnHover asChild>
											<button type="button" onClick={() => navigate(openPath(file))} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted">
												<FileText className="size-5 shrink-0 text-muted-foreground" />
												<span className="min-w-0">
													<span className="block truncate font-medium">{file.split("/").pop()}</span>
													<span className="block truncate font-mono text-xs text-muted-foreground">{file}</span>
												</span>
											</button>
										</AnimateIcon>
									</li>
								))}
							</ul>
						)}
					</Section>

					<Section title="Activity">
						{activity.length === 0 ? (
							<p className="border border-dashed p-6 text-muted-foreground">Nothing has changed yet. Create a note, file or task to get started.</p>
						) : (
							<ul className="flex flex-col">
								{activity.slice(0, 8).map((event, i) => {
									const Icon = eventIcon(event.target_type, event.action);
									return (
										<li key={event.id} className="flex gap-4">
											<div className="flex flex-col items-center">
												{event.author ? <Avatar name={event.author} className="size-9" /> : <span className="flex size-9 shrink-0 items-center justify-center bg-muted text-muted-foreground"><Icon className="size-4" /></span>}
												{i < Math.min(activity.length, 8) - 1 && <span className="w-px flex-1 bg-border" />}
											</div>
											<div className="min-w-0 flex-1 pb-5">
												<p className="flex flex-wrap items-baseline gap-x-2">
													<span className="font-semibold">{event.author ?? formatAction(event.action)}</span>
													{event.author && <span className="text-muted-foreground">{formatAction(event.action).toLowerCase()}</span>}
													<span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">{formatRelative(event.timestamp)}</span>
												</p>
												<p className="truncate text-muted-foreground">{event.detail}</p>
											</div>
										</li>
									);
								})}
							</ul>
						)}
					</Section>
				</div>

				<aside className="flex flex-col gap-10">
					<Section title="People" aside={`${[...online].filter((n) => members.some((m) => m.name === n)).length} online`}>
						<ul className="flex flex-col gap-1">
							{members.map((m) => {
								const here = online.has(m.name);
								return (
									<li key={m.id} className="flex items-center gap-3 px-1 py-1.5">
										<span className="relative">
											<Avatar name={m.name} className={cn("size-9", !here && "opacity-50")} />
											<span className={cn("absolute -right-0.5 -bottom-0.5 size-3 ring-2 ring-background", here ? "bg-success" : "bg-muted-foreground/50")} />
										</span>
										<span className="min-w-0">
											<span className={cn("block truncate font-medium", !here && "text-muted-foreground")}>{m.name}</span>
											<span className="block text-xs text-muted-foreground">{m.role}</span>
										</span>
									</li>
								);
							})}
						</ul>
					</Section>

					<Section title="Due soon">
						{due.length === 0 ? (
							<p className="border border-dashed p-6 text-muted-foreground">No dates set. Give a task a due date and it appears here.</p>
						) : (
							<ul className="divide-y border bg-card">
								{due.map((task) => {
									const late = task.due_date! < today;
									return (
										<li key={task.id}>
											<AnimateIcon animateOnHover asChild>
												<button type="button" onClick={() => navigate(`/workspace/tasks?open=${encodeURIComponent(task.id)}`)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted">
													<span className="truncate font-medium">{task.title}</span>
													<span className={cn("flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums", late ? "text-destructive" : task.due_date === today ? "text-warning" : "text-muted-foreground")}>
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
					</Section>
				</aside>
			</div>
		</div>
	);
}
