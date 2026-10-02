import { describe, expect, it } from "vitest";

import type { KanbanCard, KanbanColumn } from "@/types/workspace";
import { addTags, byOrder, collectTags, dueState, endPosition, monthGrid, normalizeTag, planMove, tagHue, MAX_TAGS, type CardMove } from "./planning";

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
	it("moves a card to another column by writing only that card", () => {
		expect(planMove(board(), "a1", "b", 0)).toEqual([{ id: "a1", column_id: "b", position: -1 }]);
	});

	it("puts a card halfway between its neighbours without touching them", () => {
		expect(planMove(board(), "a3", "a", 1)).toEqual([{ id: "a3", column_id: "a", position: 0.5 }]);
	});

	it("numbers the column afresh only when the neighbours are too close to halve", () => {
		const crowded: KanbanColumn[] = [{ id: "a", title: "A", position: 0, cards: [card("x", "a", 5), card("y", "a", 5), card("z", "a", 9)] }];
		expect(planMove(crowded, "z", "a", 1)).toEqual([
			{ id: "x", column_id: "a", position: 0 },
			{ id: "z", column_id: "a", position: 1 },
			{ id: "y", column_id: "a", position: 2 },
		]);
	});

	it("does nothing when the card is dropped where it already is", () => {
		expect(planMove(board(), "a2", "a", 1)).toEqual([]);
	});

	it("appends when the index is past the end, and ignores unknown cards or columns", () => {
		expect(planMove(board(), "a1", "b", 99)).toEqual([{ id: "a1", column_id: "b", position: 1 }]);
		expect(planMove(board(), "nope", "b", 0)).toEqual([]);
		expect(planMove(board(), "a1", "nope", 0)).toEqual([]);
		expect(endPosition([])).toBe(0);
		expect(endPosition(board()[0].cards)).toBe(3);
	});

	it("orders equal positions by id so every device shows the same column", () => {
		const tied = [card("b", "a", 5), card("a", "a", 5), card("c", "a", 1)];
		expect(tied.sort(byOrder).map((c) => c.id)).toEqual(["c", "a", "b"]);
	});
});

// Two devices, offline, each drop one card somewhere in the same column. They then sync the way the app does: every
// card's position is a field, and the later write to a field wins. What matters is that each person's drop is still
// where they put it, relative to the cards the other person did not move.
describe("two devices reordering a column at once", () => {
	const N = 8;
	const TRIALS = 2000;
	type Plan = (cards: KanbanCard[], id: string, index: number) => CardMove[];

	// The scheme this replaced: renumber the whole column 0..n-1 on every drop
	const renumber: Plan = (cards, id, index) => {
		const rest = cards.filter((c) => c.id !== id);
		const at = Math.max(0, Math.min(index, rest.length));
		const ordered = [...rest.slice(0, at), cards.find((c) => c.id === id)!, ...rest.slice(at)];
		return ordered.map((c, position) => ({ id: c.id, column_id: "a", position, was: c })).filter((m) => m.was.position !== m.position).map(({ id, column_id, position }) => ({ id, column_id, position }));
	};
	const halving: Plan = (cards, id, index) => planMove([{ id: "a", title: "A", position: 0, cards }], id, "a", index);

	// A small deterministic generator, so a failure can be reproduced
	const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

	function run(plan: Plan, step: number) {
		const rand = rng(7);
		let broken = 0;
		let writes = 0;
		for (let t = 0; t < TRIALS; t++) {
			const cards = Array.from({ length: N }, (_, i) => card(`c${i}`, "a", i * step));
			const drops = [0, 1].map(() => ({ id: `c${Math.floor(rand() * N)}`, index: Math.floor(rand() * N) }));
			const moves = drops.map((d) => plan(cards, d.id, d.index));
			writes += moves[0].length + moves[1].length;
			const final = new Map(cards.map((c) => [c.id, c.position]));
			for (const m of moves.flat()) final.set(m.id, m.position); // device 1 writes last, so it wins a shared field
			const order = [...final].map(([id, position]) => ({ id, position })).sort(byOrder).map((c) => c.id);
			drops.forEach((d, who) => {
				const other = [drops[1 - who].id]; // the one card the other person meant to move
				if (other.includes(d.id) || moves[who].length === 0) return;
				const local = new Map(cards.map((c) => [c.id, c.position]));
				for (const m of moves[who]) local.set(m.id, m.position);
				const mine = [...local].map(([id, position]) => ({ id, position })).sort(byOrder).map((c) => c.id);
				const at = mine.indexOf(d.id);
				const [p, q] = [mine[at - 1], mine[at + 1]];
				const bad =
					(p && !other.includes(p) && order.indexOf(p) > order.indexOf(d.id)) || (q && !other.includes(q) && order.indexOf(q) < order.indexOf(d.id));
				if (bad) broken++;
			});
		}
		return { broken: broken / (2 * TRIALS), writes: writes / (2 * TRIALS) };
	}

	it("keeps every drop in place with fractional positions, which renumbering does not", () => {
		const before = run(renumber, 1);
		const after = run(halving, 1);
		console.log(`drops misplaced: renumbering ${(before.broken * 100).toFixed(1)}% (${before.writes.toFixed(1)} writes per drop); fractional ${(after.broken * 100).toFixed(1)}% (${after.writes.toFixed(2)} writes per drop)`);
		expect(before.broken).toBeGreaterThan(0.1);
		expect(after.broken).toBe(0);
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
