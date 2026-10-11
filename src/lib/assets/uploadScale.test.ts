import { describe, expect, it } from "vitest";

import { canDownscale } from "./uploadScale";

describe("canDownscale", () => {
	it("is true for pictures made of pixels", () => {
		for (const name of ["a.png", "b.JPG", "c.jpeg", "d.webp"]) expect(canDownscale(name)).toBe(true);
	});
	it("is false for animated, vector and other files", () => {
		for (const name of ["a.gif", "b.svg", "c.pdf", "noextension"]) expect(canDownscale(name)).toBe(false);
	});
});
