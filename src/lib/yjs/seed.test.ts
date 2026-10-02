import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { seedText } from "./seed";

const sync = (a: Y.Doc, b: Y.Doc) => {
	Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
	Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};

describe("seedText", () => {
	it("is not doubled when two devices seed the same file and then meet", () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		seedText(a, "hello\nworld\n");
		seedText(b, "hello\nworld\n");
		sync(a, b);
		expect(a.getText("content").toString()).toBe("hello\nworld\n");
		expect(b.getText("content").toString()).toBe("hello\nworld\n");
	});

	it("keeps each person's typing on top of the shared seed", () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		seedText(a, "one two");
		seedText(b, "one two");
		a.getText("content").insert(0, "A ");
		b.getText("content").insert(7, " B");
		sync(a, b);
		expect(a.getText("content").toString()).toBe("A one two B");
		expect(b.getText("content").toString()).toBe(a.getText("content").toString());
	});

	it("still converges when the two files differ", () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		seedText(a, "version a");
		seedText(b, "version b");
		sync(a, b);
		expect(a.getText("content").toString()).toBe(b.getText("content").toString());
		expect(a.getText("content").toString()).toContain("version");
	});

	it("leaves a text that already has content alone, and ignores an empty file", () => {
		const d = new Y.Doc();
		d.getText("content").insert(0, "kept");
		seedText(d, "other");
		expect(d.getText("content").toString()).toBe("kept");
		const e = new Y.Doc();
		seedText(e, "");
		expect(e.getText("content").length).toBe(0);
	});
});
