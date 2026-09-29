import { describe, expect, it } from "vitest";

import { isShortCode } from "@/lib/p2p/transport";

describe("isShortCode", () => {
	it("accepts 6 digits with optional space or dash", () => {
		for (const ok of ["048213", "048 213", "048-213", "  048213  "]) {
			expect(isShortCode(ok), ok).toBe(true);
		}
	});

	it("rejects tickets and malformed codes", () => {
		for (const bad of ["", "12345", "1234567", "12345a", "nexsync1abcdef", "048 21 3"]) {
			expect(isShortCode(bad), bad).toBe(false);
		}
	});
});
