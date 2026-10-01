import { describe, expect, it } from "vitest";

import type { KanbanCard, KanbanColumn } from "@/types/workspace";
import { addTags, collectTags, dueState, monthGrid, normalizeTag, planMove, tagHue, MAX_TAGS } from "./planning";

describe("tags", () => {
	it("normalizes to a short lowercase slug without a leading #", () => {
		expect(normalizeTag("  #Back End ")).toBe("back-end");
		expect(normalizeTag("x".repeat(50))).toHaveLength(32);
		expect(normalizeTag("   ")).toBe("");
	});

	it("adds several tags at once, skipping blanks and duplicates", () => {
		expect(addTags(["api"], "ui, API,, #Docs\nui")).toEqual(["api", "ui", "docs"]);
	});

	it("stops at the limit the backend enforces", () => {
		const many = Array.from({ length: 20 }, (_, i) => `t${i}`).join(",");
		expect(addTags([], many)).toHaveLength(MAX_TAGS);
	});

	it("collects each tag once, alphabetically, and colours a tag the same way every time", () => {
		expect(collectTags([{ tags: ["b", "a"] }, { tags: ["a"] }, {}])).toEqual(["a", "b"]);
		expect(tagHue("urgent")).toBe(tagHue("urgent"));
		expect(tagHue("urgent")).toBeLessThan(360);
	});
});

describe("dueState", () => {
	const today = "2026-03-10";
	it("warns about overdue, today and the next three days", () => {
		expect(dueState("2026-03-09", false, today)).toBe("overdue");
		expect(dueState("2026-03-10", false, today)).toBe("today");
		expect(dueState("2026-03-13", false, today)).toBe("soon");
		expect(dueState("2026-03-14", false, today)).toBe("later");
	});

	it("ignores finished work and missing or unreadable dates", () => {
		expect(dueState("2026-03-01", true, today)).toBeNull();
		expect(dueState(undefined, false, today)).toBeNull();
		expect(dueState("soonish", false, today)).toBeNull();
	});

	it("reads a full timestamp by its calendar day", () => {
		expect(dueState("2026-03-10T00:00:00.000Z", false, today)).toBe("today");
	});
});

const card = (id: string, column_id: string, position: number): KanbanCard => ({
	id,
	column_id,
	position,
	title: id,
	description: "",
	created_at: "t",
	updated_at: "t",
	tags: [],
	checklist: [],
});
const board = (): KanbanColumn[] => [
	{ id: "a", title: "A", position: 0, cards: [card("a1", "a", 0), card("a2", "a", 1), card("a3", "a", 2)] },
	{ id: "b", title: "B", position: 1, cards: [card("b1", "b", 0)] },
];

describe("planMove", () => {
	it("moves a card to another column and shifts the cards after it", () => {
		expect(planMove(board(), "a1", "b", 0)).toEqual([
			{ id: "a1", column_id: "b", position: 0 },
			{ id: "b1", column_id: "b", position: 1 },
		]);
	});

	it("reorders inside a column and only reports the cards that moved", () => {
		expect(planMove(board(), "a3", "a", 0)).toEqual([
			{ id: "a3", column_id: "a", position: 0 },
			{ id: "a1", column_id: "a", position: 1 },
			{ id: "a2", column_id: "a", position: 2 },
		]);
	});

	it("does nothing when the card is dropped where it already is", () => {
		expect(planMove(board(), "a2", "a", 1)).toEqual([]);
	});

	it("appends when the index is past the end, and ignores unknown cards or columns", () => {
		expect(planMove(board(), "a1", "b", 99)).toEqual([{ id: "a1", column_id: "b", position: 1 }]);
		expect(planMove(board(), "nope", "b", 0)).toEqual([]);
		expect(planMove(board(), "a1", "nope", 0)).toEqual([]);
	});
});

describe("monthGrid", () => {
	it("covers the month in whole weeks starting on Monday", () => {
		const weeks = monthGrid(2026, 2); // March 2026 starts on a Sunday
		expect(weeks[0][0]).toBe("2026-02-23");
		expect(weeks[0][6]).toBe("2026-03-01");
		expect(weeks.flat()).toContain("2026-03-31");
		expect(weeks.every((w) => w.length === 7)).toBe(true);
	});
});
