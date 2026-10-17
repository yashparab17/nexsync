import { describe, expect, it } from "vitest";

import { displaySize } from "@/features/assets/lib/displaySize";
import { canDownscale, scaledSize } from "@/features/assets/lib/uploadScale";

describe("displaySize", () => {
	it("draws a picture bigger than 500 pixels either way at half size", () => {
		expect(displaySize(700, 700)).toEqual({ width: 350, height: 350, halved: true });
		expect(displaySize(1400, 300)).toEqual({ width: 700, height: 150, halved: true });
	});
	it("leaves a picture of 500 by 500 or less alone", () => {
		expect(displaySize(500, 500)).toEqual({ width: 500, height: 500, halved: false });
		expect(displaySize(320, 200).halved).toBe(false);
	});
});

describe("upload scale", () => {
	it("scales both sides and never reaches zero", () => {
		expect(scaledSize(700, 700, 50)).toEqual({ width: 350, height: 350 });
		expect(scaledSize(1000, 400, 0)).toEqual({ width: 100, height: 40 });
		expect(scaledSize(1, 1, 10)).toEqual({ width: 1, height: 1 });
	});
	it("only resizes pictures made of pixels", () => {
		for (const name of ["a.png", "b.JPG", "c.webp"]) expect(canDownscale(name)).toBe(true);
		for (const name of ["a.gif", "b.svg", "c.pdf", "noextension"]) expect(canDownscale(name)).toBe(false);
	});
});
