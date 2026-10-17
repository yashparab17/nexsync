import { describe, expect, it } from "vitest";

import { whyConflict } from "@/lib/conflictWhy";

describe("whyConflict", () => {
	it("names both writers, oldest first, and says neither probably saw the other", () => {
		const text = whyConflict(
			[
				{ value: "B", ts: 2_000_000, who: "Ana" },
				{ value: "A", ts: 1_000_000, who: "Bo" },
			],
			String,
		);
		expect(text.indexOf("Bo set “A”")).toBeLessThan(text.indexOf("Ana set “B”"));
		expect(text).toContain("probably");
	});
	it("says nothing for a single value and counts extras", () => {
		expect(whyConflict([{ value: 1, ts: 1 }], String)).toBe("");
		expect(whyConflict([1, 2, 3].map((v) => ({ value: v, ts: v })), String)).toContain("and 1 more");
	});
});
