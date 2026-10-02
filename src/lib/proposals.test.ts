import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { accept, isCurrent, listProposals, locate, openProposals, propose, reject } from "./proposals";

const doc = (text: string) => {
	const d = new Y.Doc();
	d.getText("content").insert(0, text);
	return d;
};
const text = (d: Y.Doc) => d.getText("content").toString();

// Everything one device knows reaches the other, as the sync layer does
const sync = (a: Y.Doc, b: Y.Doc) => {
	Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
	Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};

describe("suggested edits", () => {
	it("does not change the text until it is accepted, and then replaces just that part", () => {
		const d = doc("the quick brown fox");
		const t = d.getText("content");
		const p = propose(d, t, 4, 9, "slow", "Sam");
		expect(text(d)).toBe("the quick brown fox");
		expect(accept(d, t, p.id, "Kim")).toBe("applied");
		expect(text(d)).toBe("the slow brown fox");
		expect(listProposals(d)[0]).toMatchObject({ status: "accepted", closedBy: "Kim", by: "Sam" });
	});

	it("stays on the same words while others type around it", () => {
		const a = doc("one two three");
		const b = new Y.Doc();
		sync(a, b);
		const p = propose(a, a.getText("content"), 4, 7, "2", "Sam"); // "two"
		sync(a, b);
		b.getText("content").insert(0, "zero ");
		b.getText("content").insert(b.getText("content").length, " four");
		sync(a, b);
		const at = locate(b, openProposals(b)[0])!;
		expect(text(b).slice(at.from, at.to)).toBe("two");
		expect(accept(b, b.getText("content"), p.id, "Kim")).toBe("applied");
		sync(a, b);
		expect(text(a)).toBe("zero one 2 three four");
		expect(text(b)).toBe(text(a));
	});

	it("keeps words typed just outside the range outside it", () => {
		const d = doc("ab cd ef");
		const t = d.getText("content");
		const p = propose(d, t, 3, 5, "XX", "Sam");
		t.insert(3, ">");
		t.insert(6, "<");
		expect(accept(d, t, p.id, "Kim")).toBe("applied");
		expect(text(d)).toBe("ab >XX< ef");
	});

	it("will not replace words that changed since it was made, unless forced", () => {
		const d = doc("the quick fox");
		const t = d.getText("content");
		const p = propose(d, t, 4, 9, "slow", "Sam");
		t.insert(6, "!"); // "quick" becomes "qu!ick" while still under the suggestion
		expect(isCurrent(d, t, openProposals(d)[0])).toBe(false);
		expect(accept(d, t, p.id, "Kim")).toBe("changed");
		expect(text(d)).toBe("the qu!ick fox");
		expect(accept(d, t, p.id, "Kim", true)).toBe("applied");
		expect(text(d)).toBe("the slow fox");
	});

	it("proposes insertions and deletions", () => {
		const d = doc("hello world");
		const t = d.getText("content");
		const ins = propose(d, t, 5, 5, ",", "Sam");
		const del = propose(d, t, 6, 11, "", "Sam");
		accept(d, t, ins.id, "Kim");
		accept(d, t, del.id, "Kim");
		expect(text(d)).toBe("hello, ");
	});

	it("is settled once: a second accept or a reject after it does nothing", () => {
		const d = doc("abc");
		const t = d.getText("content");
		const p = propose(d, t, 0, 1, "A", "Sam");
		expect(reject(d, p.id, "Kim")).toBe(true);
		expect(accept(d, t, p.id, "Kim")).toBe("gone");
		expect(reject(d, p.id, "Kim")).toBe(false);
		expect(text(d)).toBe("abc");
		expect(openProposals(d)).toHaveLength(0);
	});

	it("two people accepting the same suggestion at once still converge and close it", () => {
		const a = doc("one two");
		const b = new Y.Doc();
		sync(a, b);
		const p = propose(a, a.getText("content"), 4, 7, "2", "Sam");
		sync(a, b);
		accept(a, a.getText("content"), p.id, "Kim");
		accept(b, b.getText("content"), p.id, "Lee");
		sync(a, b);
		// Both typed the replacement, so it may appear twice; what matters is that both devices agree
		expect(text(a)).toBe(text(b));
		expect(openProposals(a)).toHaveLength(0);
	});

	it("refuses a range that is not there, a no-op, and an oversized suggestion", () => {
		const d = doc("abc");
		const t = d.getText("content");
		expect(() => propose(d, t, 2, 9, "x", "Sam")).toThrow();
		expect(() => propose(d, t, 0, 1, "a", "Sam")).toThrow();
		expect(() => propose(d, t, 0, 1, "x".repeat(20_001), "Sam")).toThrow();
	});

	it("ignores entries in the shared map that are not suggestions", () => {
		const d = doc("abc");
		d.getMap("proposals").set("junk", { id: 1 });
		d.getMap("proposals").set("also", "text");
		expect(listProposals(d)).toEqual([]);
	});
});
