// =TASKS() and =CARDS(): a cell holding one of these shows the workspace's tasks or kanban cards as a table that starts at that cell.
// The table is added to the workbook the engine calculates (not to the shared document), so formulas can read it, and it is made
// again whenever the workspace's tasks change.

import { a1Of, parseA1, type SheetIn } from "@/features/office/sheets/lib/sheet";
import type { KanbanColumn, Task } from "@/types/workspace";

const MAX_ROWS = 5000;

export const TASK_HEAD = ["Title", "Status", "Priority", "Due", "Assignee", "Tags"];
export const CARD_HEAD = ["Title", "Column", "Due", "Assignee", "Tags"];

export const taskRows = (tasks: Task[]): string[][] => [TASK_HEAD, ...tasks.slice(0, MAX_ROWS).map((t) => [t.title, t.status, t.priority, t.due_date ?? "", t.assignee_id ?? "", t.tags.join(", ")])];
export const cardRows = (columns: KanbanColumn[]): string[][] => [CARD_HEAD, ...columns.flatMap((c) => c.cards.map((k) => [k.title, c.title, k.due_date ?? "", k.assignee_id ?? "", k.tags.join(", ")])).slice(0, MAX_ROWS)];

const LIVE = /^=\s*(TASKS|CARDS)\(\s*\)$/i;

// The sheets with each =TASKS() or =CARDS() cell replaced by its table (the cell itself holds the heading)
export function expandLive(book: SheetIn[], live: { tasks: string[][]; cards: string[][] }): SheetIn[] {
	return book.map((sheet) => {
		let cells: Record<string, string> | null = null;
		for (const [a1, text] of Object.entries(sheet.cells)) {
			const m = LIVE.exec(text.trim());
			const at = m ? parseA1(a1) : null;
			if (!m || !at) continue;
			cells ??= { ...sheet.cells };
			(m[1].toUpperCase() === "TASKS" ? live.tasks : live.cards).forEach((row, i) => row.forEach((v, j) => (cells![a1Of(at.row + i, at.col + j)] = v)));
		}
		return cells ? { ...sheet, cells } : sheet;
	});
}
