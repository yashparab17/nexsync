// Applies collaborators' task and kanban edits to the local workspace database

import { createKanbanColumn, deleteKanbanCard, deleteKanbanColumn, deleteTask, eraseFileForGood, eraseRecordForGood, mergeCardRecord, mergeTaskRecord } from "@/lib/tauri";
import type { KanbanCard, Task } from "@/types/workspace";
import type { DataChange } from "./types";

// A collaborator's copy of a task or card is merged into ours field by field, so edits made to different fields
// while apart both stay, and two values for the same field are kept as a conflict for someone to settle
export async function upsertTask(path: string, task: Task): Promise<void> {
	await mergeTaskRecord(path, task);
}

export async function upsertKanbanCard(path: string, card: KanbanCard): Promise<void> {
	await mergeCardRecord(path, card);
}

export async function applyDataChange(path: string, change: DataChange): Promise<void> {
	switch (change.entity) {
		case "task":
			if (change.op === "upsert") await upsertTask(path, change.task);
			else if (change.erase) await eraseRecordForGood(path, "task", change.id);
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
			else if (change.erase) await eraseRecordForGood(path, "card", change.id);
			else await deleteKanbanCard({ path, id: change.id });
			break;
		case "file":
			// Another device erased a file for good; the same is done here
			await eraseFileForGood(path, change.path, change.docIds);
			break;
	}
}
