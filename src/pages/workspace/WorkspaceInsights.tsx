import { useEffect, useMemo, useState } from "react";
import { BarChart3, History, X } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	authorOf,
	countBy,
	filterEvents,
	isCompletion,
	KINDS,
	kindOf,
	perDay,
	workload,
	type ActivityFilter,
} from "@/lib/insights";
import { getKanban, getTasks } from "@/lib/tauri";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { KanbanColumn, Task } from "@/types/workspace";

const DAYS = 14;
const FEED_LIMIT = 100;

// A horizontal bar per row, scaled to the biggest
function Bars({ rows, empty }: { rows: [string, number][]; empty: string }) {
	const max = Math.max(1, ...rows.map(([, n]) => n));
	if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
	return (
		<ul className="space-y-2">
			{rows.map(([label, n]) => (
				<li key={label} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-2 text-sm">
					<span className="truncate" title={label}>
						{label}
					</span>
					<span className="h-3 bg-muted">
						<span className="block h-full bg-primary transition-[width] duration-500" style={{ width: `${(n / max) * 100}%` }} />
					</span>
					<span className="text-right tabular-nums text-muted-foreground">{n}</span>
				</li>
			))}
		</ul>
	);
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<Card>
			<CardContent className="p-4">
				<p className="text-2xl font-bold tabular-nums">{value}</p>
				<p className="text-xs text-muted-foreground">{label}</p>
			</CardContent>
		</Card>
	);
}

// Who did what and when, worked out from the workspace activity log, with a filterable feed and per-item history
export default function WorkspaceInsights() {
	const { workspace, metadata } = useWorkspace();
	const { dataVersion } = useP2P();
	const events = useMemo(() => metadata?.activity.events ?? [], [metadata]);
	const members = useMemo(() => metadata?.members.members ?? [], [metadata]);

	const [tasks, setTasks] = useState<Task[]>([]);
	const [columns, setColumns] = useState<KanbanColumn[]>([]);
	const [filter, setFilter] = useState<ActivityFilter>({});
	const set = (patch: ActivityFilter) => setFilter((f) => ({ ...f, ...patch }));

	useEffect(() => {
		if (!workspace?.path) return;
		void Promise.all([getTasks(workspace.path).catch(() => []), getKanban(workspace.path).catch(() => [])]).then(([t, c]) => {
			setTasks(t);
			setColumns(c);
		});
	}, [workspace?.path, dataVersion]);

	const byPerson = useMemo(() => countBy(events, authorOf), [events]);
	const byKind = useMemo(() => countBy(events, kindOf), [events]);
	const finished = useMemo(() => countBy(events.filter(isCompletion), authorOf), [events]);
	const days = useMemo(() => perDay(events, DAYS), [events]);
	const load = useMemo(() => workload(tasks, columns, members), [tasks, columns, members]);
	const feed = useMemo(() => filterEvents(events, filter), [events, filter]);
	const peak = Math.max(1, ...days.map((d) => d.count));
	const openTasks = tasks.filter((t) => t.status !== "done").length;
	const filtered = Object.values(filter).some(Boolean);

	return (
		<div className="space-y-6">
			<div>
				<h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
					<BarChart3 className="size-6 text-primary" />
					Insights
				</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Who has been doing what in this workspace. Based on the latest {events.length} recorded actions
					{events.some((e) => !e.author) && "; older ones have no name attached"}.
				</p>
			</div>

			<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
				<Stat label="Actions recorded" value={events.length} />
				<Stat label="People active" value={byPerson.filter(([n]) => n !== "Unknown").length} />
				<Stat label="Tasks finished" value={finished.reduce((n, [, c]) => n + c, 0)} />
				<Stat label="Tasks still open" value={openTasks} />
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Actions by person</CardTitle>
						<CardDescription>Everything recorded in the activity log, by who did it.</CardDescription>
					</CardHeader>
					<CardContent>
						<Bars rows={byPerson} empty="Nothing recorded yet." />
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>Tasks finished</CardTitle>
						<CardDescription>Tasks moved to Done, by the person who moved them.</CardDescription>
					</CardHeader>
					<CardContent>
						<Bars rows={finished} empty="No task has been finished yet." />
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>Open work by person</CardTitle>
						<CardDescription>Tasks and cards not yet done, by who they are assigned to.</CardDescription>
					</CardHeader>
					<CardContent>
						<Bars rows={load.map((w) => [`${w.name} (${w.tasks} tasks, ${w.cards} cards)`, w.tasks + w.cards])} empty="Nothing is open." />
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>Where the work happens</CardTitle>
						<CardDescription>Actions by part of the app.</CardDescription>
					</CardHeader>
					<CardContent>
						<Bars rows={byKind} empty="Nothing recorded yet." />
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Last {DAYS} days</CardTitle>
					<CardDescription>Actions per day, today on the right.</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex h-32 items-end gap-1" role="img" aria-label={`Actions per day over the last ${DAYS} days`}>
						{days.map((d) => (
							<div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${d.count}`}>
								<div className="bg-primary transition-[height] duration-500" style={{ height: `${(d.count / peak) * 100}%`, minHeight: d.count ? 2 : 0 }} />
							</div>
						))}
					</div>
					<div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
						<span>{days[0]?.day.slice(5)}</span>
						<span>{days[days.length - 1]?.day.slice(5)}</span>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Activity feed</CardTitle>
					<CardDescription>Filter by person, part of the app or text. Press History on a task or card event to follow just that item.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="flex flex-wrap items-center gap-2">
						<Input
							aria-label="Search activity"
							placeholder="Search activity"
							value={filter.query ?? ""}
							onChange={(e) => set({ query: e.target.value })}
							className="h-9 w-56"
						/>
						<select
							aria-label="Person"
							value={filter.author ?? ""}
							onChange={(e) => set({ author: e.target.value || undefined })}
							className="h-9 border border-input bg-background px-2 text-sm"
						>
							<option value="">Everyone</option>
							{byPerson.map(([name]) => (
								<option key={name}>{name}</option>
							))}
						</select>
						<select
							aria-label="Part of the app"
							value={filter.kind ?? ""}
							onChange={(e) => set({ kind: (e.target.value || undefined) as ActivityFilter["kind"] })}
							className="h-9 border border-input bg-background px-2 text-sm"
						>
							<option value="">Everything</option>
							{KINDS.map((k) => (
								<option key={k}>{k}</option>
							))}
						</select>
						{filter.target && (
							<span className="inline-flex items-center gap-1 border border-primary/40 bg-primary/10 px-2 py-1 text-xs">
								<History className="size-3" />
								History of one item
							</span>
						)}
						{filtered && (
							<button type="button" onClick={() => setFilter({})} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
								<X className="size-3" />
								Clear filters
							</button>
						)}
					</div>

					{feed.length === 0 ? (
						<p className="text-sm text-muted-foreground">{events.length === 0 ? "No activity yet." : "Nothing matches these filters."}</p>
					) : (
						<ul className="divide-y divide-border/60">
							{feed.slice(0, FEED_LIMIT).map((e) => (
								<li key={e.id} className="flex items-start justify-between gap-3 py-2 text-sm">
									<div className="min-w-0">
										<p className="truncate font-medium">{e.action}</p>
										<p className="truncate text-xs text-muted-foreground">{e.detail}</p>
									</div>
									<div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
										{e.target && /^(task|card):/.test(e.target) && (
											<button
												type="button"
												onClick={() => set({ target: e.target })}
												aria-label={`History of this ${e.target.split(":")[0]}`}
												className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"
											>
												<History className="size-3" />
												History
											</button>
										)}
										<span>{authorOf(e)}</span>
										<span title={e.timestamp}>{new Date(e.timestamp).toLocaleString()}</span>
									</div>
								</li>
							))}
						</ul>
					)}
					{feed.length > FEED_LIMIT && (
						<p className="text-xs text-muted-foreground">
							Showing the latest {FEED_LIMIT} of {feed.length}. Narrow the filters to see the rest.
						</p>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
