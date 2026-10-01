import { describe, expect, it } from "vitest";

import { authorOf, countBy, filterEvents, isCompletion, itemTarget, kindOf, perDay, workload } from "./insights";
import type { ActivityEvent, KanbanColumn, Member, Task } from "@/types/workspace";

const ev = (over: Partial<ActivityEvent>): ActivityEvent => ({ id: "e", timestamp: "2026-03-10T12:00:00", action: "Created task", detail: "Created task: A", ...over });

describe("activity insights", () => {
	it("classifies events and names their author", () => {
		expect(kindOf(ev({ target_type: "task" }))).toBe("Tasks");
		expect(kindOf(ev({ target_type: "uploaded_asset" }))).toBe("Assets");
		expect(kindOf(ev({ target_type: undefined }))).toBe("Other");
		expect(authorOf(ev({}))).toBe("Unknown");
		expect(authorOf(ev({ author: " Ana " }))).toBe("Ana");
	});

	it("counts by key, biggest first", () => {
		expect(countBy(["a", "b", "b", "c", "c"], (s) => s)).toEqual([["b", 2], ["c", 2], ["a", 1]]);
	});

	it("buckets events by local day with empty days included, today last", () => {
		const days = perDay([ev({ timestamp: "2026-03-10T09:00:00" }), ev({ timestamp: "2026-03-10T20:00:00" }), ev({ timestamp: "2026-03-08T09:00:00" }), ev({ timestamp: "garbage" })], 3, new Date(2026, 2, 10, 15));
		expect(days).toEqual([{ day: "2026-03-08", count: 1 }, { day: "2026-03-09", count: 0 }, { day: "2026-03-10", count: 2 }]);
	});

	it("recognises a task finished", () => {
		expect(isCompletion(ev({ action: "Updated task status", detail: 'Changed "A" to done' }))).toBe(true);
		expect(isCompletion(ev({ action: "Updated task status", detail: 'Changed "A" to todo' }))).toBe(false);
	});

	it("filters by part of the app, person, text and one item", () => {
		const events = [
			ev({ id: "1", author: "Ana", target_type: "task", target: itemTarget("task", "t1") }),
			ev({ id: "2", author: "Bo", target_type: "kanban", target: itemTarget("card", "c1"), detail: "Moved card to Done" }),
			ev({ id: "3", author: "Ana", target_type: "note" }),
		];
		expect(filterEvents(events, { author: "Ana" }).map((e) => e.id)).toEqual(["1", "3"]);
		expect(filterEvents(events, { kind: "Kanban" }).map((e) => e.id)).toEqual(["2"]);
		expect(filterEvents(events, { query: "moved" }).map((e) => e.id)).toEqual(["2"]);
		expect(filterEvents(events, { target: "task:t1" }).map((e) => e.id)).toEqual(["1"]);
		expect(filterEvents(events, {})).toHaveLength(3);
	});

	it("totals open work per person, ignoring done tasks and the Done column", () => {
		const members = [{ id: "m1", name: "Ana", role: "Owner" }] as Member[];
		const task = (id: string, status: Task["status"], assignee_id?: string) => ({ id, status, assignee_id }) as Task;
		const card = (id: string, assignee_id?: string) => ({ id, assignee_id }) as KanbanColumn["cards"][number];
		const columns = [
			{ id: "a", title: "Doing", position: 0, cards: [card("1", "m1"), card("2")] },
			{ id: "b", title: "Done", position: 1, cards: [card("3", "m1")] },
		] as KanbanColumn[];
		expect(workload([task("t1", "todo", "m1"), task("t2", "done", "m1"), task("t3", "todo")], columns, members)).toEqual([
			{ name: "Ana", tasks: 1, cards: 1 },
			{ name: "Unassigned", tasks: 1, cards: 1 },
		]);
	});
});
