import { describe, expect, it } from "vitest";

import { accessibilityProblems, hasDescription } from "@/features/office/documents/lib/documentAccessibility";
import type { BlockLike } from "@/features/office/documents/lib/documentFind";

const text = (t: string) => [{ type: "text" as const, text: t, styles: {} }];
const heading = (id: string, level: number, t: string) => ({ id, type: "heading", props: { level }, content: text(t) }) as BlockLike;
const para = (id: string, t = "") => ({ id, type: "paragraph", content: t ? text(t) : [] }) as BlockLike;
const kinds = (blocks: BlockLike[]) => accessibilityProblems(blocks).map((p) => `${p.kind}:${p.blockId}`);

describe("accessibility problems in a document", () => {
	it("finds nothing in a well-made document", () => {
		const blocks = [
			heading("h1", 1, "Report"),
			para("p1", "Some text"),
			heading("h2", 2, "Part one"),
			{ id: "img", type: "image", props: { name: "Sales rose in March" } } as unknown as BlockLike,
			{ id: "t", type: "table", content: { type: "tableContent", headerRows: 1, rows: [] } } as unknown as BlockLike,
			{ id: "l", type: "paragraph", content: [{ type: "link", href: "https://example.com", content: text("the annual accounts") }] } as BlockLike,
		];
		expect(kinds(blocks)).toEqual([]);
	});

	it("knows what a description is: not nothing, a file name or the name of a shape", () => {
		expect(hasDescription("A bar chart of sales")).toBe(true);
		for (const bad of [undefined, "", "  ", "photo.jpg", "IMG_2041.PNG", "image", "rect", "Picture 3"]) expect(hasDescription(bad)).toBe(false);
	});

	it("flags a picture that nobody described", () => {
		expect(kinds([{ id: "i", type: "image", props: { name: "scan.png" } } as unknown as BlockLike])).toEqual(["picture:i"]);
	});

	it("flags a heading that skips a level, once, and one with no text", () => {
		expect(kinds([heading("a", 1, "A"), heading("b", 3, "B"), heading("c", 3, "C")])).toEqual(["heading-order:b"]);
		expect(kinds([heading("a", 1, "A"), heading("b", 2, "  ")])).toEqual(["heading-empty:b"]);
		// The first heading of a document may start at level 2 only if something precedes it at level 1; a document that begins at 2 skips one
		expect(accessibilityProblems([heading("a", 2, "A")])[0].message).toMatch(/none to level 2/);
	});

	it("flags a table without a header row", () => {
		expect(kinds([{ id: "t", type: "table", content: { type: "tableContent", rows: [] } } as unknown as BlockLike])).toEqual(["table-header:t"]);
	});

	it("flags links that say nothing about where they go", () => {
		const link = (id: string, t: string) => ({ id, type: "paragraph", content: [{ type: "link", href: "https://x", content: text(t) }] }) as BlockLike;
		expect(kinds([link("a", "click here"), link("b", "https://example.com/very/long"), link("c", "the 2026 report")])).toEqual(["link-text:a", "link-text:b"]);
	});

	it("flags blank paragraphs used as spacing, once for a run of them", () => {
		expect(kinds([para("a", "x"), para("b"), para("c"), para("d"), para("e", "y")])).toEqual(["blank-lines:c"]);
		expect(kinds([para("a", "x"), para("b"), para("c", "y")])).toEqual([]);
	});

	it("looks inside nested blocks", () => {
		const nested = { id: "p", type: "bulletListItem", content: text("item"), children: [{ id: "i", type: "image", props: {} }] } as unknown as BlockLike;
		expect(kinds([nested])).toEqual(["picture:i"]);
	});
});
