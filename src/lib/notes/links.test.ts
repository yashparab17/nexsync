import { describe, expect, it } from "vitest";

import { extractHeadings, extractLinks, findBacklinks, linkAt, noteTitle, resolveLink, type NoteRef } from "./links";

const note = (name: string): NoteRef => ({ name, path: `/notes/${name}` });

describe("extractLinks", () => {
	it("finds links, uses the target of an aliased link, and lists each note once", () => {
		expect(extractLinks("See [[Plan]] and [[Budget|the money]], again [[plan]].")).toEqual(["Plan", "Budget"]);
	});

	it("ignores links inside code and unfinished links", () => {
		const text = "`[[inline]]`\n```\n[[fenced]]\n```\n[[open\n[[]]\n[[real]]";
		expect(extractLinks(text)).toEqual(["real"]);
	});
});

describe("resolveLink", () => {
	const notes = [note("Plan.md"), note("Budget 2026.md")];
	it("matches a title or a file name, ignoring case", () => {
		expect(resolveLink("plan", notes)).toBe(notes[0]);
		expect(resolveLink("BUDGET 2026.md", notes)).toBe(notes[1]);
		expect(resolveLink("Missing", notes)).toBeUndefined();
	});

	it("titles drop only the last extension", () => {
		expect(noteTitle("v1.2 notes.md")).toBe("v1.2 notes");
		expect(noteTitle("README")).toBe("README");
	});
});

describe("findBacklinks", () => {
	it("lists the other notes that link here, not the note itself", () => {
		const plan = note("Plan.md");
		const a = note("A.md");
		const b = note("B.md");
		const found = findBacklinks(plan, [
			{ note: plan, text: "I link to [[plan]]" },
			{ note: a, text: "Start from [[Plan]]" },
			{ note: b, text: "Nothing here" },
		]);
		expect(found).toEqual([a]);
	});
});

describe("extractHeadings", () => {
	it("reads headings with their levels and line numbers, skipping code", () => {
		const text = "# Title\n\ntext\n## Part *one*\n```\n# not a heading\n```\n###### Deep ##\n#nospace";
		expect(extractHeadings(text)).toEqual([
			{ level: 1, text: "Title", line: 1 },
			{ level: 2, text: "Part *one*", line: 4 },
			{ level: 6, text: "Deep", line: 8 },
		]);
	});
});

describe("linkAt", () => {
	const line = "see [[Plan|x]] and [[Budget]]";
	it("returns the link under the offset", () => {
		expect(linkAt(line, 6)).toBe("Plan");
		expect(linkAt(line, 25)).toBe("Budget");
	});
	it("returns null outside a link", () => {
		expect(linkAt(line, 1)).toBeNull();
		expect(linkAt(line, 16)).toBeNull();
	});
});
