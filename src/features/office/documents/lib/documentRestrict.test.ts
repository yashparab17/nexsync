import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { access, isRestriction } from "@/features/office/documents/lib/documentRestrict";

describe("restricting who may edit a document", () => {
	const editor = { readOnly: false, canComment: true };
	const viewer = { readOnly: true, canComment: false };

	it("changes nothing when nothing is restricted", () => {
		expect(access("none", false, editor)).toEqual(editor);
		expect(access("none", false, viewer)).toEqual(viewer);
	});

	it("takes editing away from an Editor and leaves commenting, or takes both", () => {
		expect(access("comments", false, editor)).toEqual({ readOnly: true, canComment: true });
		expect(access("read", false, editor)).toEqual({ readOnly: true, canComment: false });
	});

	it("never gives back what a Viewer did not have", () => {
		expect(access("comments", false, viewer)).toEqual({ readOnly: true, canComment: false });
	});

	it("never restricts an Owner or an Admin", () => {
		for (const r of ["comments", "read"] as const) expect(access(r, true, editor)).toEqual(editor);
	});

	it("knows a restriction from anything else a shared document might hold", () => {
		expect(["none", "comments", "read"].every(isRestriction)).toBe(true);
		for (const bad of [undefined, null, "", "lock", 3]) expect(isRestriction(bad)).toBe(false);
	});

	it("reaches another device through the shared document", () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		a.getMap("docSettings").set("restrict", "comments");
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
		expect(b.getMap("docSettings").get("restrict")).toBe("comments");
	});
});
