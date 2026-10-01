import { describe, expect, it } from "vitest";

import { dueReminders } from "./reminders";
import type { KanbanColumn, Task } from "@/types/workspace";

const task = (id: string, over: Partial<Task>) => ({ id, title: id, status: "todo", assignee_id: "me", ...over }) as Task;
const column = (title: string, cards: object[]) => ({ id: title, title, position: 0, cards }) as unknown as KanbanColumn;

describe("due reminders", () => {
	it("lists my open items that are due today or late, and nothing else", () => {
		const tasks = [
			task("late", { due_date: "2026-03-09" }),
			task("today", { due_date: "2026-03-10" }),
			task("soon", { due_date: "2026-03-11" }),
			task("finished", { due_date: "2026-03-01", status: "done" }),
			task("theirs", { due_date: "2026-03-01", assignee_id: "other" }),
		];
		const columns = [
			column("Doing", [{ id: "k1", title: "Card A", assignee_id: "me", due_date: "2026-03-10" }]),
			column("Done", [{ id: "k2", title: "Card B", assignee_id: "me", due_date: "2026-03-01" }]),
		];
		expect(dueReminders(tasks, columns, "me", "2026-03-10")).toEqual([
			{ key: "task:late:overdue", text: 'Task "late" is overdue' },
			{ key: "task:today:today", text: 'Task "today" is due today' },
			{ key: "card:k1:today", text: 'Card "Card A" is due today' },
		]);
	});
});
