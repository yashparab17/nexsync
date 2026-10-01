import { describe, expect, it } from "vitest";

import { colorForName, colorLightForName } from "./collabColor";
import { ACCENTS, accentFor, accentSoft } from "./palette";

describe("palette", () => {
	it("gives the same text the same accent, always one of the Catppuccin ones", () => {
		expect(accentFor("urgent")).toBe(accentFor("urgent"));
		expect(ACCENTS).toContain(accentFor("anything at all"));
		expect(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => accentFor(s))).size).toBeGreaterThan(3);
	});

	it("writes colours as theme variables, with a soft version for backgrounds", () => {
		expect(colorForName("Yash")).toMatch(/^var\(--ctp-[a-z]+\)$/);
		expect(colorLightForName("Yash")).toContain("color-mix(in srgb, var(--ctp-");
		expect(accentSoft("teal", 15)).toBe("color-mix(in srgb, var(--ctp-teal) 15%, transparent)");
	});
});
