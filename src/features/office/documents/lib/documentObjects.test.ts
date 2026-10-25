import { describe, expect, it } from "vitest";

import { cropBox, listLabel } from "@/features/office/documents/lib/documentObjects";

describe("document objects", () => {
	it("labels list levels", () => {
		expect([1, 2, 3].map((n) => listLabel(n, 0))).toEqual(["1.", "2.", "3."]);
		expect([1, 2, 27].map((n) => listLabel(n, 1))).toEqual(["a.", "b.", "aa."]);
		expect([1, 4, 9, 14].map((n) => listLabel(n, 2))).toEqual(["i.", "iv.", "ix.", "xiv."]);
		expect(listLabel(1, 3)).toBe("1.");
	});
	it("works out crops", () => {
		expect(cropBox(200, 100, "square")).toEqual({ x: 50, y: 0, w: 100, h: 100 });
		expect(cropBox(160, 100, "trim")).toEqual({ x: 16, y: 10, w: 128, h: 80 });
		const wide = cropBox(100, 100, "wide");
		expect(wide.w).toBe(100);
		expect(wide.h).toBeCloseTo(56.25);
	});
});
