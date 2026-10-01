import { describe as suite, expect, it } from "vitest";
import * as Y from "yjs";

import { authorOf, canRevertField, describe, groupByAuthor, replaceText, revertHunk, revertValue, textHunks } from "@/lib/catchup";
import type { CatchupEntry } from "@/types/workspace";

const look = { member: (id: string) => (id === "m1" ? "Sam" : "someone"), column: (id: string) => (id === "done" ? "Done" : id) };

function entry(over: Partial<CatchupEntry>): CatchupEntry {
	return { id: 1, at: 1000, kind: "field", entity: "task", target: "t1", label: "Fix bug", path: "title", before: null, after: null, who: "Sam", signer: null, state: "new", ...over };
}

suite("grouping", () => {
	it("groups by author, most recent author first, and names the unknown", () => {
		const groups = groupByAuthor([entry({ id: 3, at: 300, who: "Ana" }), entry({ id: 2, at: 200, who: null }), entry({ id: 1, at: 100, who: "Ana" }), entry({ id: 4, at: 400, who: "Sam" })]);
		expect(groups.map((g) => [g.who, g.entries.length])).toEqual([["Sam", 1], ["Ana", 2], ["A collaborator", 1]]);
	});
});

suite("authors", () => {
	const members = [{ name: "Samuel", deviceId: "key-sam" }, { name: "Ana" }];

	it("takes the name from the member list when the change is signed by that member's key", () => {
		expect(authorOf(entry({ who: "Sam", signer: "key-sam" }), members)).toEqual({ name: "Samuel", signed: true, vouched: true });
	});

	it("does not trust a name that nothing vouches for", () => {
		// Signed by a key nobody listed, so the name is only a claim; and with no signature at all
		expect(authorOf(entry({ who: "Ana", signer: "key-other" }), members)).toEqual({ name: "Ana", signed: true, vouched: false });
		expect(authorOf(entry({ who: "Ana", signer: null }), members)).toEqual({ name: "Ana", signed: false, vouched: false });
		expect(authorOf(entry({ who: null, signer: null }), members).name).toBe("A collaborator");
	});

	it("shows a forged name for what it is: the key's owner is named, whatever the write claims", () => {
		const groups = groupByAuthor([entry({ id: 1, who: "Ana", signer: "key-sam" }), entry({ id: 2, who: "Samuel", signer: "key-sam" })], members);
		expect(groups.map((g) => [g.who, g.entries.length, g.vouched])).toEqual([["Samuel", 2, true]]);
	});

	it("marks a group by its least trusted change", () => {
		const [group] = groupByAuthor([entry({ id: 1, who: "Ana", signer: "key-sam" }), entry({ id: 2, who: "Samuel", signer: null })], members);
		expect(group.who).toBe("Samuel");
		expect(group.vouched).toBe(false);
	});
});

suite("describing", () => {
	it("says what changed in words, using names instead of ids", () => {
		expect(describe(entry({ before: '"Old"', after: '"New"' }), look)).toBe('Changed the title of "Fix bug" from Old to New');
		expect(describe(entry({ path: "assignee_id", before: null, after: '"m1"' }), look)).toBe('Changed the assignee of "Fix bug" from nothing to Sam');
		expect(describe(entry({ entity: "card", path: "column_id", before: '"todo"', after: '"done"' }), look)).toContain("to Done");
		expect(describe(entry({ path: "tags/urgent", after: "true" }), look)).toBe('Added the tag "urgent" to "Fix bug"');
		expect(describe(entry({ path: "tags/urgent", before: "true" }), look)).toBe('Removed the tag "urgent" from "Fix bug"');
		expect(describe(entry({ path: "comments/c1", after: '{"text":"Looks good"}' }), look)).toBe('Commented on "Fix bug": Looks good');
		expect(describe(entry({ entity: "card", path: "checklist/i1/done", before: "false", after: "true" }), look)).toBe('Ticked a checklist item on "Fix bug"');
		expect(describe(entry({ kind: "created" }), look)).toBe('Added "Fix bug"');
		expect(describe(entry({ kind: "deleted" }), look)).toBe('Deleted "Fix bug"');
	});

	it("undoes a field by writing its old value back, and clears what had none", () => {
		expect(revertValue(entry({ before: '"Old"', after: '"New"' }))).toBe("Old");
		expect(revertValue(entry({ path: "tags/urgent", before: null, after: "true" }))).toBeNull();
		expect(canRevertField(entry({}))).toBe(true);
		expect(canRevertField(entry({ state: "reverted" }))).toBe(false);
		expect(canRevertField(entry({ kind: "created" }))).toBe(false);
	});
});

const before = ["# Plan", "", "one", "two", "three", "", "four", "five", "six", ""].join("\n");
const after = ["# Plan", "", "one", "TWO", "three", "", "four", "five", "six", "seven", ""].join("\n");

suite("text hunks", () => {
	it("splits a change into runs of lines with their surroundings", () => {
		const hunks = textHunks(before, after);
		expect(hunks).toHaveLength(2);
		expect(hunks[0]).toEqual({ oldLines: ["two"], newLines: ["TWO"], above: ["", "one"], below: ["three", ""] });
		expect(hunks[1].newLines).toEqual(["seven"]);
		expect(hunks[1].below).toEqual([]);
	});

	it("undoes one hunk and leaves the other", () => {
		const [first] = textHunks(before, after);
		expect(revertHunk(after, first)).toBe(after.replace("TWO", "two"));
	});

	it("still finds a hunk after somebody else edited elsewhere", () => {
		const [first] = textHunks(before, after);
		const edited = after.replace("# Plan", "# Plan v2").replace("six", "SIX");
		expect(revertHunk(edited, first)).toBe(edited.replace("TWO", "two"));
	});

	it("restores deleted lines, and removes added lines at the end of the file", () => {
		const gone = ["a", "b", "c", "d"].join("\n");
		const [hunk] = textHunks(gone, ["a", "d"].join("\n"));
		expect(revertHunk(["a", "d"].join("\n"), hunk)).toBe(gone);
		const [, tail] = textHunks(before, after);
		expect(revertHunk(after, tail)).toBe(after.replace("seven\n", ""));
	});

	it("gives up instead of guessing when the lines were edited again, or are ambiguous", () => {
		const [first] = textHunks(before, after);
		expect(revertHunk(after.replace("TWO", "Two!"), first)).toBeNull();
		expect(revertHunk(`${after}${after}`, first)).toBeNull();
		expect(revertHunk(after.replace(/\n/g, "\r\n"), first)).toBeNull();
	});

	it("does not treat a hunk at the start of the file as matching further down", () => {
		const [hunk] = textHunks("x\ny", "NEW\nx\ny");
		expect(revertHunk("NEW\nx\ny", hunk)).toBe("x\ny");
		expect(revertHunk("x\ny\nNEW\nx\ny", hunk)).toBeNull();
	});
});

suite("replacing text", () => {
	it("changes only the part that differs, so other people's edits elsewhere are untouched", () => {
		const doc = new Y.Doc();
		const text = doc.getText("content");
		text.insert(0, "hello brave world");
		const seen: string[] = [];
		text.observe((e) => seen.push(JSON.stringify(e.changes.delta)));
		replaceText(text, "hello kind world");
		expect(text.toString()).toBe("hello kind world");
		expect(seen.join()).not.toContain("hello");
	});

	it("does not split an emoji", () => {
		const doc = new Y.Doc();
		const text = doc.getText("content");
		text.insert(0, "a😀b");
		replaceText(text, "a😁b");
		expect(text.toString()).toBe("a😁b");
	});
});
