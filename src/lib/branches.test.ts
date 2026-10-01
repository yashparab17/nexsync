import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { branchDocId, closeBranch, listBranches, mergeBranch, previewMerge, startBranch } from "./branches";

const textOf = (doc: Y.Doc) => doc.getText("content").toString();

function fileWith(text: string) {
	const doc = new Y.Doc();
	doc.getText("content").insert(0, text);
	return doc;
}

// Opens the branch's own document from the state it was forked with
function open(state: Uint8Array) {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, state);
	return doc;
}

describe("branches", () => {
	it("forks a document, records the branch in the file and keeps its content separate", () => {
		const main = fileWith("one\ntwo\n");
		const { branch, state } = startBranch(main, "  Try a rename  ", "Ana", "b1", 100);
		expect(branch).toMatchObject({ id: "b1", name: "Try a rename", by: "Ana", status: "open" });
		expect(branchDocId("b1")).toBe("branch:b1");
		expect(listBranches(main)).toEqual([branch]);

		const copy = open(state);
		expect(textOf(copy)).toBe("one\ntwo\n");
		expect(listBranches(copy)).toEqual([]); // The copy was taken before the record was made
		copy.getText("content").insert(0, "zero\n");
		expect(textOf(main)).toBe("one\ntwo\n");
		expect(() => startBranch(main, "   ", "Ana")).toThrow(/name/);
	});

	it("previews what a merge would do without changing the file, then makes the same change", () => {
		const main = fileWith("alpha\nbeta\ngamma\n");
		const { branch, state } = startBranch(main, "edit", "Ana", "b1", 1);
		const copy = open(state);
		copy.getText("content").insert(0, "BRANCH\n"); // The branch edits the top...
		main.getText("content").insert(main.getText("content").length, "MAIN\n"); // ...while the file edits the bottom

		const branchState = Y.encodeStateAsUpdate(copy);
		const { before, after } = previewMerge(main, branchState);
		expect(before).toBe("alpha\nbeta\ngamma\nMAIN\n");
		expect(after).toBe("BRANCH\nalpha\nbeta\ngamma\nMAIN\n");
		expect(textOf(main)).toBe(before);

		mergeBranch(main, branch, branchState, "Bo", 5);
		expect(textOf(main)).toBe(after);
		expect(listBranches(main)[0]).toMatchObject({ status: "merged", closedBy: "Bo", closedAt: 5 });
	});

	it("gives the same result whatever order branches are merged in, and on every device", () => {
		const make = () => fileWith("a\nb\nc\n");
		const main = make();
		const one = startBranch(main, "one", "Ana", "b1", 1);
		const two = startBranch(main, "two", "Bo", "b2", 2);
		const b1 = open(one.state);
		const b2 = open(two.state);
		b1.getText("content").insert(0, "from-one\n");
		b2.getText("content").insert(2, "from-two\n");
		const [s1, s2] = [Y.encodeStateAsUpdate(b1), Y.encodeStateAsUpdate(b2)];

		const forward = open(Y.encodeStateAsUpdate(main));
		Y.applyUpdate(forward, s1);
		Y.applyUpdate(forward, s2);
		const backward = open(Y.encodeStateAsUpdate(main));
		Y.applyUpdate(backward, s2);
		Y.applyUpdate(backward, s1);
		expect(textOf(forward)).toBe(textOf(backward));
		expect(textOf(forward)).toContain("from-one");
		expect(textOf(forward)).toContain("from-two");
	});

	it("lists open branches first and ignores records that are not branches", () => {
		const main = fileWith("x");
		const a = startBranch(main, "old", "Ana", "a", 1).branch;
		const b = startBranch(main, "new", "Bo", "b", 2).branch;
		const c = startBranch(main, "newest", "Bo", "c", 3).branch;
		closeBranch(main, c, "Ana", 9);
		main.getMap("branches").set("junk", { id: 4 });
		expect(listBranches(main).map((x) => [x.id, x.status])).toEqual([["b", "open"], ["a", "open"], ["c", "closed"]]);
		expect(a.status).toBe("open");
		expect(b.by).toBe("Bo");
	});
});
