import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { recordAuthor } from "@/lib/editor/blame";
import { mergeSpots } from "@/lib/editor/lens";

function pair() {
	const a = new Y.Doc();
	const b = new Y.Doc();
	a.clientID = 1;
	b.clientID = 2;
	recordAuthor(a, "Ana");
	recordAuthor(b, "Ben");
	const sync = () => {
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
	};
	return { a, b, sync };
}

describe("merge spots", () => {
	it("finds the place where two people wrote at the same spot while apart", () => {
		const { a, b, sync } = pair();
		a.getText("content").insert(0, "hello world");
		sync();
		a.getText("content").insert(5, " big");
		b.getText("content").insert(5, " small");
		sync();
		const spots = mergeSpots(a.getText("content"), a.getMap("authors"));
		expect(a.getText("content").toString()).toBe(b.getText("content").toString());
		expect(spots).toHaveLength(1);
		expect(spots[0].authors.sort()).toEqual(["Ana", "Ben"]);
		expect(a.getText("content").toString().slice(spots[0].from, spots[0].to)).toMatch(/big|small/);
	});

	it("finds nothing when the edits were in different places or in turn", () => {
		const { a, b, sync } = pair();
		a.getText("content").insert(0, "one two three");
		sync();
		a.getText("content").insert(0, "A ");
		b.getText("content").insert(b.getText("content").length, " B");
		sync();
		b.getText("content").insert(2, "second ");
		sync();
		expect(mergeSpots(a.getText("content"), a.getMap("authors"))).toEqual([]);
	});
});
