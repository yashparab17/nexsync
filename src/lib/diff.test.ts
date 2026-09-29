import { describe, expect, it } from "vitest";

import { diffLines, diffWords, splitLines } from "./diff";

describe("splitLines", () => {
	it("ignores one final line break and CRLF", () => {
		expect(splitLines("a\r\nb\n")).toEqual(["a", "b"]);
		expect(splitLines("")).toEqual([]);
		expect(splitLines("\n")).toEqual([""]);
	});
});

describe("diffLines", () => {
	it("reports identical texts, even when only the last line break differs", () => {
		expect(diffLines("a\nb", "a\nb\n").identical).toBe(true);
	});

	it("marks added and removed lines with their line numbers", () => {
		const result = diffLines("one\ntwo\nthree\n", "one\nthree\nfour\n");
		expect(result.removed).toBe(1);
		expect(result.added).toBe(1);
		expect(result.rows.map((r) => `${r.kind}:${r.text}`)).toEqual(["same:one", "del:two", "same:three", "add:four"]);
		expect(result.rows[1].oldLine).toBe(2);
		expect(result.rows[3].newLine).toBe(3);
	});

	it("marks the changed words inside an edited line", () => {
		const result = diffLines("the quick brown fox\n", "the slow brown fox\n");
		const [del, add] = result.rows;
		expect(del.segments?.filter((s) => s.changed).map((s) => s.text)).toEqual(["quick"]);
		expect(add.segments?.filter((s) => s.changed).map((s) => s.text)).toEqual(["slow"]);
	});

	it("can ignore whitespace changes", () => {
		expect(diffLines("a  b\n  c\n", "a b\nc\n").identical).toBe(false);
		expect(diffLines("a  b\n  c\n", "a b\nc\n", { ignoreWhitespace: true }).identical).toBe(true);
	});

	it("handles an empty side", () => {
		expect(diffLines("", "x\ny\n").added).toBe(2);
		expect(diffLines("x\ny\n", "").removed).toBe(2);
	});

	it("still finishes on a large change", () => {
		const a = Array.from({ length: 4000 }, (_, i) => `a${i}`).join("\n");
		const b = Array.from({ length: 4000 }, (_, i) => `b${i}`).join("\n");
		const result = diffLines(a, b);
		expect(result.tooLarge).toBe(true);
		expect(result.added).toBe(4000);
		expect(result.removed).toBe(4000);
	});
});

describe("diffWords", () => {
	it("keeps unchanged text between changes together", () => {
		const words = diffWords("a b c", "a x c")!;
		expect(words.old.map((s) => s.text)).toEqual(["a ", "b", " c"]);
		expect(words.new.map((s) => s.changed)).toEqual([false, true, false]);
	});
});
