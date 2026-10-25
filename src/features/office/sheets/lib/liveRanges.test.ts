import { describe, expect, it } from "vitest";

import { cardRows, expandLive, taskRows } from "@/features/office/sheets/lib/liveRanges";
import type { KanbanColumn, Task } from "@/types/workspace";

const task = (title: string, status: Task["status"]): Task => ({ id: title, title, description: "", status, priority: "high", tags: ["a", "b"], created_at: "", updated_at: "" });

describe("live ranges", () => {
	it("lays out tasks and cards", () => {
		expect(taskRows([task("Write", "todo")])).toEqual([["Title", "Status", "Priority", "Due", "Assignee", "Tags"], ["Write", "todo", "high", "", "", "a, b"]]);
		const cols = [{ id: "c", title: "Doing", position: 0, cards: [{ id: "k", title: "Fix", description: "", column_id: "c", position: 0, tags: [], checklist: [], created_at: "", updated_at: "" }] }] as KanbanColumn[];
		expect(cardRows(cols)).toEqual([["Title", "Column", "Due", "Assignee", "Tags"], ["Fix", "Doing", "", "", ""]]);
	});
	it("expands the cell that asks for them, leaving the rest", () => {
		const book = [{ name: "S", cells: { B2: "=TASKS()", A1: "x", D9: "=tasks( )", E1: "=TASKS()+1" } }];
		const [out] = expandLive(book, { tasks: [["Title", "Status"], ["Write", "todo"]], cards: [] });
		expect(out.cells.B2).toBe("Title");
		expect(out.cells.C2).toBe("Status");
		expect(out.cells.B3).toBe("Write");
		expect(out.cells.D9).toBe("Title");
		expect(out.cells.E1).toBe("=TASKS()+1");
		expect(book[0].cells.B2).toBe("=TASKS()");
	});
});
