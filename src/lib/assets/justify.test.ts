import { describe, expect, it } from "vitest";

import { justify, MAX_STRETCH } from "./justify";

const item = (id: string, aspect: number, height = 200) => ({ id, aspect, height });

describe("justify", () => {
	it("makes every full row end at the right edge", () => {
		const items = [item("a", 1), item("b", 1.5), item("c", 0.7), item("d", 1.3), item("e", 1), item("f", 2), item("g", 1)];
		const { boxes } = justify(items, 800, 8);
		const rows = new Map<number, string[]>();
		for (const [id, b] of Object.entries(boxes)) rows.set(b.y, [...(rows.get(b.y) ?? []), id]);
		const all = [...rows.values()];
		// Every row but the last reaches the full width
		for (const ids of all.slice(0, -1)) {
			const last = boxes[ids[ids.length - 1]];
			expect(Math.round(last.x + last.w)).toBe(800);
		}
	});

	it("keeps the shape of each tile", () => {
		const { boxes } = justify([item("a", 2), item("b", 0.5), item("c", 1)], 600, 8);
		for (const [id, aspect] of [["a", 2], ["b", 0.5], ["c", 1]] as const) expect(boxes[id].w / boxes[id].h).toBeCloseTo(aspect, 5);
	});

	it("never stretches a tile past the limit, and centres a row it cannot fill", () => {
		const { boxes } = justify([item("a", 1, 200)], 1000, 8);
		expect(boxes.a.h).toBeLessThanOrEqual(200 * MAX_STRETCH + 0.001);
		expect(boxes.a.x).toBeGreaterThan(100);
	});

	it("never stretches any tile past the limit, even beside tiles that want to be taller", () => {
		const items = [item("tall", 0.67, 450), item("banner", 2.4, 250), item("a", 1, 300), item("b", 1.3, 300), item("c", 0.8, 350), item("d", 1, 200)];
		const { boxes } = justify(items, 1160, 8);
		for (const it of items) expect(boxes[it.id].h).toBeLessThanOrEqual(it.height * MAX_STRETCH + 0.001);
	});

	it("handles nothing to lay out", () => {
		expect(justify([], 800, 8)).toEqual({ boxes: {}, height: 0 });
		expect(justify([item("a", 1)], 0, 8).height).toBe(0);
	});
});
