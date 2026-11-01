import { describe, expect, it } from "vitest";

import { align, distribute } from "@/features/office/slides/lib/arrange";

const slide = { w: 960, h: 540 };
const a = { id: 1, x: 10, y: 20, w: 100, h: 50 };
const b = { id: 2, x: 300, y: 200, w: 200, h: 100 };
const c = { id: 3, x: 900, y: 400, w: 50, h: 50 };

describe("align", () => {
	it("puts one shape against the slide and several against each other", () => {
		expect(align([a], "center", slide)).toEqual([{ ...a, x: 430 }]);
		expect(align([a], "bottom", slide)).toEqual([{ ...a, y: 490 }]);
		expect(align([a, b], "left", slide)).toEqual([{ ...b, x: 10 }]);
		expect(align([a, b], "right", slide)).toEqual([{ ...a, x: 400 }]);
		expect(align([a, b], "middle", slide)).toEqual([
			{ ...a, y: 135 },
			{ ...b, y: 110 },
		]);
	});

	it("returns nothing for shapes already in line", () => {
		expect(align([{ ...a, x: 10 }, { ...b, x: 10 }], "left", slide)).toEqual([]);
		expect(align([], "left", slide)).toEqual([]);
	});
});

describe("distribute", () => {
	it("leaves the outer two and makes the gaps equal", () => {
		const out = distribute([a, c, b], "h");
		expect(out).toEqual([{ ...b, x: 10 + 100 + (950 - 10 - 350) / 2 }]);
	});

	it("needs three shapes", () => {
		expect(distribute([a, b], "v")).toEqual([]);
	});
});
