import { describe, expect, it } from "vitest";

import { completeMention, makeComment, mentionSuggestions, mentions, newMentions, splitMentions } from "./comments";
import type { Comment } from "@/types/workspace";

const c = (id: string, author: string, text: string): Comment => ({ id, author, text, at: "2026-01-01T00:00:00Z" });

describe("mentions", () => {
	it("finds a mention, ignoring case, but not a longer name that starts the same", () => {
		expect(mentions("hi @yash please look", "Yash")).toBe(true);
		expect(mentions("hi @Yashwant", "Yash")).toBe(false);
		expect(mentions("no at sign, Yash", "Yash")).toBe(false);
	});

	it("matches names with spaces and prefers the longest", () => {
		const parts = splitMentions("ping @Ann Lee and @Ann", ["Ann", "Ann Lee"]);
		expect(parts.filter((p) => p.mention).map((p) => p.text)).toEqual(["@Ann Lee", "@Ann"]);
	});

	it("treats regex characters in names literally", () => {
		expect(mentions("@a.b ok", "a.b")).toBe(true);
		expect(mentions("@axb ok", "a.b")).toBe(false);
	});
});

describe("newMentions", () => {
	it("returns only new comments by others that mention me", () => {
		const before = [c("1", "Raven", "@Yash old")];
		const after = [...before, c("2", "Raven", "@Yash new"), c("3", "Yash", "@Yash self"), c("4", "Raven", "unrelated")];
		expect(newMentions(before, after, "Yash").map((x) => x.id)).toEqual(["2"]);
	});
});

describe("making and completing comments", () => {
	it("trims, drops empty text and caps the length", () => {
		expect(makeComment("   ", "A")).toBeNull();
		expect(makeComment("  hi  ", "A", new Date("2026-01-01T00:00:00Z"), "id1")).toEqual({ id: "id1", author: "A", text: "hi", at: "2026-01-01T00:00:00.000Z" });
		expect(makeComment("x".repeat(5000), "A")!.text).toHaveLength(2000);
	});

	it("suggests names after an @ and completes one", () => {
		expect(mentionSuggestions("hello @ra", ["Raven", "Yash"])).toEqual(["Raven"]);
		expect(mentionSuggestions("mail me@ra", ["Raven"])).toEqual([]);
		expect(mentionSuggestions("hello @Raven", ["Raven"])).toEqual([]);
		expect(completeMention("hello @ra", "Raven")).toBe("hello @Raven ");
	});
});
