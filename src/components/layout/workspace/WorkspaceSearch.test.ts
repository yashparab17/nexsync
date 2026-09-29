import { describe, expect, it } from "vitest";

import { snippet } from "@/components/layout/workspace/WorkspaceSearch";

describe("snippet", () => {
	it("returns text around the first match", () => {
		expect(snippet("the quick brown fox", "quick")).toContain("quick brown");
	});

	it("adds an ellipsis when the match is deep in the text", () => {
		const text = `${"x".repeat(100)} needle ${"y".repeat(100)}`;
		expect(snippet(text, "needle").startsWith("…")).toBe(true);
	});

	it("collapses whitespace and is case-insensitive", () => {
		expect(snippet("Line one\n\n  LINE two", "line two")).toBe("Line one LINE two");
	});

	it("returns an empty string when nothing matches", () => {
		expect(snippet("abc", "zzz")).toBe("");
	});
});
