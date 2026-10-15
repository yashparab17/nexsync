import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { locateAnchor, makeAnchor } from "./anchors";

const doc = (text: string) => {
	const d = new Y.Doc();
	d.getText("content").insert(0, text);
	return d;
};
const sync = (a: Y.Doc, b: Y.Doc) => {
	Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
	Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
};

describe("comment anchors", () => {
	it("stays on its words while other people type before, after and beside them", () => {
		const d = doc("one two three four");
		const t = d.getText("content");
		const anchor = makeAnchor(t, 4, 9)!; // "two t"
		expect(anchor.quote).toBe("two t");
		t.insert(0, "zero ");
		t.insert(t.length, " five");
		t.insert(9 + 5, "X"); // right after the comment's last character: outside it
		const at = locateAnchor(d, t, anchor);
		expect(at).toEqual({ state: "on", from: 9, to: 14 });
		expect(t.toString().slice(9, 14)).toBe("two t");
	});

	it("is found again by its words when the line is moved (deleted and typed again)", () => {
		const d = doc("alpha\nthe commented line\nomega\n");
		const t = d.getText("content");
		const anchor = makeAnchor(t, 6, 24)!;
		// The line is cut and pasted below omega
		t.delete(6, 19);
		t.insert(t.length, "the commented line\n");
		const at = locateAnchor(d, t, anchor);
		expect(at.state).toBe("moved");
		if (at.state === "orphaned") return;
		expect(t.toString().slice(at.from, at.to)).toBe("the commented line");
	});

	it("stays on edited words, and is orphaned when they are gone", () => {
		const d = doc("keep the exact phrase here");
		const t = d.getText("content");
		const anchor = makeAnchor(t, 5, 21)!; // "the exact phrase"
		t.insert(12, "XX"); // inside: "the exactXX phrase"
		const edited = locateAnchor(d, t, anchor);
		expect(edited.state).toBe("changed");
		t.delete(0, t.length);
		t.insert(0, "something else entirely");
		expect(locateAnchor(d, t, anchor)).toEqual({ state: "orphaned" });
	});

	it("keeps both people's comments in place after a merge of concurrent edits", () => {
		const a = doc("first line\nsecond line\nthird line\n");
		const b = new Y.Doc();
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
		const anchor = makeAnchor(a.getText("content"), 11, 22)!;
		a.getText("content").insert(0, "title\n");
		b.getText("content").insert(b.getText("content").length, "fourth line\n");
		sync(a, b);
		for (const d of [a, b]) {
			const at = locateAnchor(d, d.getText("content"), anchor);
			expect(at.state).toBe("on");
			if (at.state !== "orphaned") expect(d.getText("content").toString().slice(at.from, at.to)).toBe("second line");
		}
	});

	it("makes no anchor for an empty or out-of-range selection", () => {
		const t = doc("abc").getText("content");
		expect(makeAnchor(t, 1, 1)).toBeNull();
		expect(makeAnchor(t, 0, 99)).toBeNull();
		expect(makeAnchor(t, -1, 2)).toBeNull();
	});
});
