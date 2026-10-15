// Telling a person about the tasks and cards they follow or are given. Each check compares what is there now with what was
// there at the last check, so nothing is announced twice and the first check announces nothing.

import type { KanbanColumn, Task } from "@/types/workspace";

export interface Seen {
	title: string;
	assignee: string; // Member id, or empty
	sig: string; // The parts a person would notice changing
}

export type Snapshot = Record<string, Seen>; // by "task:<id>" or "card:<id>"

export function snapshotOf(tasks: Task[], columns: KanbanColumn[]): Snapshot {
	const out: Snapshot = {};
	for (const t of tasks) out[`task:${t.id}`] = { title: t.title, assignee: t.assignee_id ?? "", sig: JSON.stringify([t.title, t.description, t.status, t.priority, t.due_date ?? "", t.assignee_id ?? "", t.tags]) };
	for (const c of columns) {
		for (const k of c.cards) out[`card:${k.id}`] = { title: k.title, assignee: k.assignee_id ?? "", sig: JSON.stringify([k.title, k.description, k.column_id, k.due_date ?? "", k.assignee_id ?? "", k.tags]) };
	}
	return out;
}

export interface FollowEvent {
	key: string;
	text: string;
	follow: boolean; // Being given the item also follows it
}

export function followEvents(before: Snapshot | null, now: Snapshot, me: string, followed: Set<string>): FollowEvent[] {
	if (!before || !me) return [];
	const out: FollowEvent[] = [];
	for (const [key, item] of Object.entries(now)) {
		const was = before[key];
		if (!was) continue;
		const kind = key.startsWith("task:") ? "task" : "card";
		if (item.assignee === me && was.assignee !== me) out.push({ key, text: `The ${kind} "${item.title}" was assigned to you.`, follow: true });
		else if (followed.has(key) && was.sig !== item.sig) out.push({ key, text: `The ${kind} "${item.title}" you follow was changed.`, follow: false });
	}
	return out;
}
