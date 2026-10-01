// Numbers and filters behind the Insights page, worked out from the workspace activity log

import { localDay } from "@/lib/planning";
import type { ActivityEvent, KanbanColumn, Member, Task } from "@/types/workspace";

export const KINDS = ["Tasks", "Kanban", "Notes", "Files", "Assets", "Members", "Settings", "Other"] as const;
export type Kind = (typeof KINDS)[number];

// Which part of the app an event belongs to, from its target type
export function kindOf(e: ActivityEvent): Kind {
	const t = (e.target_type ?? "").toLowerCase();
	if (t === "task") return "Tasks";
	if (t === "kanban") return "Kanban";
	if (t === "note") return "Notes";
	if (t === "file" || t === "folder") return "Files";
	if (t.includes("asset")) return "Assets";
	if (t === "member") return "Members";
	if (t === "settings") return "Settings";
	return "Other";
}

export const UNKNOWN = "Unknown";
export const authorOf = (e: ActivityEvent) => e.author?.trim() || UNKNOWN;

// Item events carry "task:<id>" or "card:<id>" as their target, so one item's history can be picked out
export const itemTarget = (type: "task" | "card", id: string) => `${type}:${id}`;

// Groups items by a key and counts them, biggest first
export function countBy<T>(items: T[], key: (item: T) => string): [string, number][] {
	const counts = new Map<string, number>();
	for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// Events per calendar day for the last `days` days, oldest first, today last
export function perDay(events: ActivityEvent[], days: number, now = new Date()): { day: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const e of events) {
		const when = new Date(e.timestamp);
		if (!Number.isNaN(when.getTime())) counts.set(localDay(when), (counts.get(localDay(when)) ?? 0) + 1);
	}
	return Array.from({ length: days }, (_, i) => {
		const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - i));
		const day = localDay(d);
		return { day, count: counts.get(day) ?? 0 };
	});
}

// A task moved to Done
export const isCompletion = (e: ActivityEvent) => e.action === "Updated task status" && / to done$/.test(e.detail);

export interface ActivityFilter {
	kind?: Kind;
	author?: string;
	query?: string;
	target?: string;
}

// The events that match every filter that is set
export function filterEvents(events: ActivityEvent[], f: ActivityFilter): ActivityEvent[] {
	const q = f.query?.trim().toLowerCase();
	return events.filter(
		(e) =>
			(!f.kind || kindOf(e) === f.kind) &&
			(!f.author || authorOf(e) === f.author) &&
			(!f.target || e.target === f.target) &&
			(!q || `${e.action} ${e.detail} ${authorOf(e)}`.toLowerCase().includes(q)),
	);
}

export interface Workload {
	name: string;
	tasks: number;
	cards: number;
}

// Open tasks and cards per person; a task is open until Done, a card until it sits in a column called Done
export function workload(tasks: Task[], columns: KanbanColumn[], members: Member[]): Workload[] {
	const name = (id?: string) => (id ? (members.find((m) => m.id === id)?.name ?? UNKNOWN) : "Unassigned");
	const rows = new Map<string, Workload>();
	const row = (n: string) => rows.get(n) ?? rows.set(n, { name: n, tasks: 0, cards: 0 }).get(n)!;
	for (const t of tasks) if (t.status !== "done") row(name(t.assignee_id)).tasks++;
	for (const c of columns) {
		if (/^done$/i.test(c.title.trim())) continue;
		for (const k of c.cards) row(name(k.assignee_id)).cards++;
	}
	return [...rows.values()].sort((a, b) => b.tasks + b.cards - (a.tasks + a.cards) || a.name.localeCompare(b.name));
}
