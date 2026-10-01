// What is due today or overdue for one person, as short messages for the notification bell

import { dueState, localDay } from "@/lib/planning";
import type { KanbanColumn, Task } from "@/types/workspace";

export interface Reminder {
	key: string; // Stable per item and urgency, so each is announced once
	text: string;
}

// Open tasks and cards assigned to `memberId` that are due today or late; a card is open until it sits in a column called Done
export function dueReminders(tasks: Task[], columns: KanbanColumn[], memberId: string, today = localDay()): Reminder[] {
	const out: Reminder[] = [];
	const add = (kind: "task" | "card", id: string, title: string, due: string | undefined, done: boolean) => {
		const state = dueState(due, done, today);
		if (state === "overdue" || state === "today") {
			out.push({ key: `${kind}:${id}:${state}`, text: `${kind === "task" ? "Task" : "Card"} "${title}" is ${state === "today" ? "due today" : "overdue"}` });
		}
	};
	for (const t of tasks) if (t.assignee_id === memberId) add("task", t.id, t.title, t.due_date, t.status === "done");
	for (const c of columns) {
		const done = /^done$/i.test(c.title.trim());
		for (const k of c.cards) if (k.assignee_id === memberId) add("card", k.id, k.title, k.due_date, done);
	}
	return out;
}
