import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyMatch } from "@/lib/fuzzy";

describe("fuzzy matching", () => {
	it("needs every letter in order", () => {
		expect(fuzzyMatch("mn", "main.rs")).not.toBeNull();
		expect(fuzzyMatch("nm", "main.rs")).toBeNull();
		expect(fuzzyMatch("xyz", "main.rs")).toBeNull();
	});

	it("returns the matched positions", () => {
		expect(fuzzyMatch("mrs", "main.rs")?.indexes).toEqual([0, 5, 6]);
	});

	it("ranks a file name above a folder that happens to match", () => {
		const hits = fuzzyFilter(["src/utils/other.ts", "other/readme.md", "docs/main.md"], "main", (s) => s);
		expect(hits[0].item).toBe("docs/main.md");
	});

	it("keeps the given order when nothing is typed", () => {
		const hits = fuzzyFilter(["b", "a"], "  ", (s) => s);
		expect(hits.map((h) => h.item)).toEqual(["b", "a"]);
	});
});
