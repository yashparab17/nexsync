import { describe, expect, it } from "vitest";
import { parseNaturalDate } from "@/lib/naturalDate";
import { parseQuickAdd } from "@/lib/quickAdd";

// Monday 2 November 2026
const mon = new Date(2026, 10, 2);

describe("parseNaturalDate", () => {
	it("reads relative words", () => {
		expect(parseNaturalDate("today", mon)).toBe("2026-11-02");
		expect(parseNaturalDate("tomorrow", mon)).toBe("2026-11-03");
		expect(parseNaturalDate("next week", mon)).toBe("2026-11-09");
		expect(parseNaturalDate("in 3 days", mon)).toBe("2026-11-05");
	});
	it("reads weekday names as the coming one", () => {
		expect(parseNaturalDate("fri", mon)).toBe("2026-11-06");
		expect(parseNaturalDate("mon", mon)).toBe("2026-11-09");
		expect(parseNaturalDate("next fri", mon)).toBe("2026-11-13");
	});
	it("rejects other text", () => {
		expect(parseNaturalDate("whenever", mon)).toBeNull();
		expect(parseNaturalDate("", mon)).toBeNull();
	});
});

describe("parseQuickAdd", () => {
	it("pulls tags, priority and due date out of the title", () => {
		expect(parseQuickAdd("Fix login #Bug !high @fri", mon)).toEqual({ title: "Fix login", priority: "high", tags: ["bug"], due: "2026-11-06" });
	});
	it("keeps text that only looks like a due date", () => {
		expect(parseQuickAdd("email @bob", mon).title).toBe("email @bob");
	});
});
