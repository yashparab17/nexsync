// Applies collaborators' task and kanban edits to the local workspace database

import {
	createKanbanCard,
	createKanbanColumn,
	createTask,
	deleteKanbanCard,
	deleteKanbanColumn,
	deleteTask,
	updateKanbanCard,
	updateTask,
} from "@/lib/tauri";
import type { KanbanCard, Task } from "@/types/workspace";
import type { DataChange } from "./types";

// Inserting fails when the row already exists, so fall back to updating it
export async function upsertTask(path: string, task: Task): Promise<void> {
	try {
		await createTask({ path, task });
	} catch {
		await updateTask({ path, task });
	}
}

export async function upsertKanbanCard(path: string, card: KanbanCard): Promise<void> {
	try {
		await createKanbanCard({ path, card });
	} catch {
		await updateKanbanCard({ path, card });
	}
}

export async function applyDataChange(path: string, change: DataChange): Promise<void> {
	switch (change.entity) {
		case "task":
			if (change.op === "upsert") await upsertTask(path, change.task);
			else await deleteTask({ path, id: change.id });
			break;
		case "column":
			// Columns can't be edited after creation, so an existing one is already up to date
			if (change.op === "upsert") {
				await createKanbanColumn({ path, column: { ...change.column, cards: [] } }).catch(() => {});
			} else {
				await deleteKanbanColumn({ path, id: change.id });
			}
			break;
		case "card":
			if (change.op === "upsert") await upsertKanbanCard(path, change.card);
			else await deleteKanbanCard({ path, id: change.id });
			break;
	}
}
