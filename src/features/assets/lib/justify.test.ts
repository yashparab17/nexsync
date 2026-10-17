import { describe, expect, it } from "vitest";

import { justify, LAST_STRETCH, MAX_STRETCH } from "@/features/assets/lib/justify";

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

	it("keeps a lone tile at the left and within the last row's limit", () => {
		const { boxes } = justify([item("a", 1, 200)], 1000, 8);
		expect(boxes.a.h).toBeLessThanOrEqual(200 * LAST_STRETCH + 0.001);
		expect(boxes.a.x).toBe(0);
	});

	it("stretches a short gallery's only row up to the last-row limit to fill the width", () => {
		const items = Array.from({ length: 7 }, (_, i) => item(`t${i}`, 1, 200));
		const { boxes } = justify(items, 1500, 8);
		const last = boxes.t6;
		expect(Math.round(last.x + last.w)).toBe(1500);
	});

	it("never stretches any tile past the limit, even beside tiles that want to be taller", () => {
		const items = [item("tall", 0.67, 450), item("banner", 2.4, 250), item("a", 1, 300), item("b", 1.3, 300), item("c", 0.8, 350), item("d", 1, 200)];
		const { boxes } = justify(items, 1160, 8);
		// Every row but the last is held to MAX_STRETCH
		const ys = [...new Set(items.map((it) => boxes[it.id].y))].sort((a, b) => a - b);
		for (const it of items) if (boxes[it.id].y !== ys[ys.length - 1]) expect(boxes[it.id].h).toBeLessThanOrEqual(it.height * MAX_STRETCH + 0.001);
	});

	it("lays out tiles whose size is unusable instead of breaking the whole set", () => {
		const { boxes, height } = justify([item("a", NaN, 200), item("b", 0, 0), item("c", 1.2, Infinity), item("d", 1.5, 220)], 900, 8);
		expect(Number.isFinite(height) && height > 0).toBe(true);
		for (const b of Object.values(boxes)) for (const v of [b.x, b.y, b.w, b.h]) expect(Number.isFinite(v)).toBe(true);
		expect(Object.keys(boxes)).toHaveLength(4);
	});

	it("handles nothing to lay out", () => {
		expect(justify([], 800, 8)).toEqual({ boxes: {}, height: 0 });
		expect(justify([item("a", 1)], 0, 8).height).toBe(0);
	});
});
