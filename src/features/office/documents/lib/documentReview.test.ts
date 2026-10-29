import { describe, expect, it } from "vitest";

import { compareLines, markValue, readMark } from "@/features/office/documents/lib/documentReview";

describe("tracked change marks", () => {
	it("keep who and when, whatever the name holds", () => {
		const v = markValue("Ana | Bo", new Date("2026-10-26T10:00:00Z"));
		expect(readMark(v)).toEqual({ author: "Ana / Bo", date: "2026-10-26T10:00:00.000Z" });
		expect(readMark("Ana")).toEqual({ author: "Ana", date: "" });
	});
});

describe("compareLines", () => {
	it("says nothing about identical text", () => {
		const c = compareLines(["One", "Two"], ["One", "Two"]);
		expect(c.insertions + c.deletions).toBe(0);
		expect(c.rows.every((r) => r.kind === "same")).toBe(true);
	});

	it("marks a paragraph that was added and one that was removed", () => {
		const c = compareLines(["Keep", "Gone", "End"], ["Keep", "End", "New"]);
		expect(c.rows.map((r) => r.kind)).toEqual(["same", "deleted", "same", "inserted"]);
		expect([c.insertions, c.deletions]).toEqual([1, 1]);
	});

	it("marks only the words that changed inside an edited paragraph", () => {
		const c = compareLines(["The quick brown fox"], ["The slow brown fox"]);
		const row = c.rows[0];
		expect(row.kind).toBe("changed");
		const text = (k: string) => row.pieces.filter((p) => p.kind === k).map((p) => p.text.trim()).join(" ");
		expect(text("deletion")).toBe("quick");
		expect(text("insertion")).toBe("slow");
		expect(row.pieces.filter((p) => p.kind !== "insertion").map((p) => p.text).join("")).toBe("The quick brown fox");
		expect(row.pieces.filter((p) => p.kind !== "deletion").map((p) => p.text).join("")).toBe("The slow brown fox");
	});
});
