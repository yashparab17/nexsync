import { useEffect, useMemo, useState } from "react";
import { History, X } from "@/components/animate-icons";

import Avatar from "@/components/elements/Avatar";
import { BarRows, DayColumns, Donut, Empty, Heatmap, MonthCalendar, SERIES, Stat, StackBar } from "@/components/elements/charts";
import { Page, PageBody, Panel } from "@/components/layout/Page";
import Toolbar, { ToolbarTitle, ToolbarSearch, ToolbarTabs } from "@/components/layout/Toolbar";
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
const WEEKS = 16;
const YEAR = 366;
const FEED_LIMIT = 100;

const select = "h-8 border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Who did what and when, worked out from the workspace activity log: charts on one tab, a filterable feed on the other
export default function WorkspaceInsights() {
	const { workspace, metadata } = useWorkspace();
	const { dataVersion } = useP2P();
	const events = useMemo(() => metadata?.activity.events ?? [], [metadata]);
	const members = useMemo(() => metadata?.members.members ?? [], [metadata]);

	const [tasks, setTasks] = useState<Task[]>([]);
	const [columns, setColumns] = useState<KanbanColumn[]>([]);
	const [tab, setTab] = useState<"overview" | "activity">("overview");
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
	const weeks = useMemo(() => perDay(events, WEEKS * 7), [events]);
	const year = useMemo(() => perDay(events, YEAR), [events]);
	const load = useMemo(() => workload(tasks, columns, members), [tasks, columns, members]);
	const feed = useMemo(() => filterEvents(events, filter), [events, filter]);
	const filtered = Object.values(filter).some(Boolean);

	const count = (f: (t: Task) => boolean) => tasks.filter(f).length;
	const done = count((t) => t.status === "done");
	const openTasks = tasks.length - done;
	const people = byPerson.filter(([n]) => n !== "Unknown").length;
	const finishedTotal = finished.reduce((n, [, c]) => n + c, 0);
	const cards = columns.reduce((n, c) => n + c.cards.length, 0);

	return (
		<Page>
			<Toolbar>
				<ToolbarTitle name="Insights" />
				<ToolbarTabs
					label="Insights"
					value={tab}
					onChange={setTab}
					tabs={[
						{ key: "overview", label: "Overview" },
						{ key: "activity", label: "Activity", count: events.length },
					]}
				/>
				<span className="flex-1" />
				{tab === "overview" ? (
					<span className="text-sm text-muted-foreground">Latest {events.length} actions{events.some((e) => !e.author) ? " · some older ones have no name" : ""}</span>
				) : (
					<>
						<ToolbarSearch label="Search activity" placeholder="Search activity" value={filter.query ?? ""} onChange={(query) => set({ query })} />
						<select aria-label="Person" value={filter.author ?? ""} onChange={(e) => set({ author: e.target.value || undefined })} className={select}>
							<option value="">Everyone</option>
							{byPerson.map(([name]) => (
								<option key={name}>{name}</option>
							))}
						</select>
						<select aria-label="Part of the app" value={filter.kind ?? ""} onChange={(e) => set({ kind: (e.target.value || undefined) as ActivityFilter["kind"] })} className={select}>
							<option value="">Everything</option>
							{KINDS.map((k) => (
								<option key={k}>{k}</option>
							))}
						</select>
						{filter.target && (
							<span className="inline-flex h-8 items-center gap-1 border border-primary/40 bg-primary/10 px-2 text-sm">
								<History className="size-3.5" />
								History of one item
							</span>
						)}
						{filtered && (
							<button type="button" onClick={() => setFilter({})} className="inline-flex h-8 cursor-pointer items-center gap-1 px-2 text-sm text-muted-foreground hover:text-foreground">
								<X className="size-3.5" />
								Clear filters
							</button>
						)}
					</>
				)}
			</Toolbar>

			<PageBody padded={false}>
				{tab === "overview" ? (
					<div className="grid gap-3 p-3 lg:grid-cols-6">
						<div className="grid grid-cols-2 gap-3 lg:col-span-6 lg:grid-cols-4">
							<Stat label="Actions recorded" value={events.length} trend={days.map((d) => d.count)} />
							<Stat label="People active" value={people} />
							<Stat label="Tasks finished" value={finishedTotal} />
							<Stat label="Tasks still open" value={openTasks} />
						</div>

						<Panel title="Last 14 days" hint="Actions per day, today on the right" className="lg:col-span-4">
							<DayColumns days={days} label={`Actions per day over the last ${DAYS} days`} />
						</Panel>
						<Panel title="Task progress" hint={`${tasks.length} tasks, ${cards} cards`} className="lg:col-span-2">
							{tasks.length === 0 ? (
								<Empty>No tasks yet.</Empty>
							) : (
								<div className="space-y-5">
									<Donut
										label="Tasks by status"
										parts={[
											{ label: "To do", value: count((t) => t.status === "todo") },
											{ label: "In progress", value: count((t) => t.status === "in_progress") },
											{ label: "Done", value: done },
										]}
										center={
											<>
												<span className="font-mono text-2xl font-semibold tabular-nums">{Math.round((done / tasks.length) * 100)}%</span>
												<span className="text-sm text-muted-foreground">done</span>
											</>
										}
									/>
									<StackBar
										label="Tasks by priority"
										parts={[
											{ label: "High", value: count((t) => t.priority === "high"), bg: "bg-destructive" },
											{ label: "Medium", value: count((t) => t.priority === "medium"), bg: "bg-warning" },
											{ label: "Low", value: count((t) => t.priority === "low"), bg: "bg-info" },
										]}
									/>
								</div>
							)}
						</Panel>

						<Panel title="Activity calendar" hint="One month at a time, use the arrows to page" className="lg:col-span-3">
							<MonthCalendar days={year} label="Actions per day, by month" />
						</Panel>
						<Panel title="Last 16 weeks" hint="A square per day, darker when busier" className="lg:col-span-3">
							<Heatmap days={weeks} label={`Actions per day over the last ${WEEKS} weeks`} />
						</Panel>

						<Panel title="Actions by person" hint="Everything in the activity log, by who did it" className="lg:col-span-3">
							<BarRows rows={byPerson.map(([label, n]) => ({ label, parts: [{ value: n, bg: "bg-primary", title: "Actions" }] }))} lead={(l) => <Avatar name={l} className="size-6 text-xs" />} empty="Nothing recorded yet." />
						</Panel>
						<Panel title="Tasks finished" hint="Moved to Done, by who moved them" className="lg:col-span-3">
							<BarRows rows={finished.map(([label, n]) => ({ label, parts: [{ value: n, bg: "bg-success", title: "Finished" }] }))} lead={(l) => <Avatar name={l} className="size-6 text-xs" />} empty="No task has been finished yet." />
						</Panel>
						<Panel title="Open work by person" hint="Tasks and cards not yet done, by who they are assigned to" className="lg:col-span-3">
							<BarRows
								rows={load.map((w) => ({
									label: w.name,
									parts: [
										{ value: w.tasks, bg: "bg-primary", title: "Tasks" },
										{ value: w.cards, bg: "bg-info", title: "Cards" },
									],
								}))}
								lead={(l) => <Avatar name={l} className="size-6 text-xs" />}
								empty="Nothing is open."
							/>
							{load.length > 0 && (
								<p className="mt-3 flex gap-4 text-sm text-muted-foreground">
									<span className="flex items-center gap-1.5"><span className="size-3 bg-primary" aria-hidden />Tasks</span>
									<span className="flex items-center gap-1.5"><span className="size-3 bg-info" aria-hidden />Cards</span>
								</p>
							)}
						</Panel>
						<Panel title="Where the work happens" hint="Actions by part of the app" className="lg:col-span-3">
							{byKind.length === 0 ? <Empty>Nothing recorded yet.</Empty> : <Donut label="Actions by part of the app" parts={byKind.slice(0, SERIES.length).map(([label, value]) => ({ label, value }))} center={<><span className="font-mono text-2xl font-semibold tabular-nums">{events.length}</span><span className="text-sm text-muted-foreground">actions</span></>} />}
						</Panel>
					</div>
				) : feed.length === 0 ? (
					<Empty>{events.length === 0 ? "No activity yet." : "Nothing matches these filters."}</Empty>
				) : (
					<>
						<ul className="divide-y">
							{feed.slice(0, FEED_LIMIT).map((e) => (
								<li key={e.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
									<Avatar name={authorOf(e)} className="size-6 text-xs" />
									<div className="min-w-0 flex-1">
										<p className="truncate font-medium">{e.action}</p>
										<p className="truncate text-muted-foreground">{e.detail}</p>
									</div>
									<div className="flex shrink-0 items-center gap-3 text-muted-foreground">
										{e.target && /^(task|card):/.test(e.target) && (
											<button type="button" onClick={() => set({ target: e.target })} aria-label={`History of this ${e.target.split(":")[0]}`} className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground">
												<History className="size-3.5" />
												History
											</button>
										)}
										<span className="hidden sm:inline">{authorOf(e)}</span>
										<span className="font-mono text-[13px]" title={e.timestamp}>{new Date(e.timestamp).toLocaleString()}</span>
									</div>
								</li>
							))}
						</ul>
						{feed.length > FEED_LIMIT && (
							<p className="p-3 text-sm text-muted-foreground">
								Showing the latest {FEED_LIMIT} of {feed.length}. Narrow the filters to see the rest.
							</p>
						)}
					</>
				)}
			</PageBody>
		</Page>
	);
}
