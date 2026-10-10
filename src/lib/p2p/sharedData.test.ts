import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as [string, unknown][]);

vi.mock("@/lib/tauri", () => {
	const record = (name: string) => async (...args: unknown[]) => {
		calls.push([name, args]);
	};
	return {
		createKanbanColumn: record("createKanbanColumn"),
		deleteKanbanCard: record("deleteKanbanCard"),
		deleteKanbanColumn: record("deleteKanbanColumn"),
		deleteTask: record("deleteTask"),
		eraseFileForGood: record("eraseFileForGood"),
		eraseRecordForGood: record("eraseRecordForGood"),
		mergeCardRecord: record("mergeCardRecord"),
		mergeTaskRecord: record("mergeTaskRecord"),
	};
});

import { applyDataChange } from "./sharedData";

beforeEach(() => {
	calls.length = 0;
});

describe("changes from other devices", () => {
	it("deletes an ordinary delete and erases an erased one, for tasks and cards", async () => {
		await applyDataChange("/w", { entity: "task", op: "delete", id: "t1" });
		await applyDataChange("/w", { entity: "task", op: "delete", id: "t2", erase: true });
		await applyDataChange("/w", { entity: "card", op: "delete", id: "c1" });
		await applyDataChange("/w", { entity: "card", op: "delete", id: "c2", erase: true });
		expect(calls.map(([name]) => name)).toEqual(["deleteTask", "eraseRecordForGood", "deleteKanbanCard", "eraseRecordForGood"]);
		expect(calls[1][1]).toEqual(["/w", "task", "t2"]);
		expect(calls[3][1]).toEqual(["/w", "card", "c2"]);
	});

	it("erases a file, with the other documents that belong to it", async () => {
		await applyDataChange("/w", { entity: "file", op: "erase", path: "notes/a.md", docIds: ["branch:1"] });
		expect(calls).toEqual([["eraseFileForGood", ["/w", "notes/a.md", ["branch:1"]]]]);
	});
});
