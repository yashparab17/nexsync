import { describe, expect, it } from "vitest";

import { documentOutline } from "@/features/office/documents/lib/documentOutline";
import type { BlockLike } from "@/features/office/documents/lib/documentFind";

const text = (t: string) => [{ type: "text" as const, text: t, styles: {} }];

describe("a document as data", () => {
	const blocks = [
		{ id: "h", type: "heading", props: { level: 1 }, content: text("Report") },
		{ id: "p", type: "paragraph", content: [...text("See "), { type: "link", href: "https://example.com/a", content: text("the accounts") }, ...text(" now")] },
		{ id: "e", type: "paragraph", content: [] },
		{ id: "t", type: "table", content: { type: "tableContent", headerRows: 1, rows: [{ cells: [text("a"), text("b")] }, { cells: [text("c"), text("d")] }] } },
		{ id: "i1", type: "image", props: { name: "Sales by month" } },
		{ id: "i2", type: "image", props: { name: "photo.png" } },
		{ id: "n", type: "bulletListItem", content: text("item"), children: [{ id: "c", type: "paragraph", content: text("child") }] },
	] as unknown as BlockLike[];

	it("lists headings, tables, pictures, links and counts", () => {
		const o = documentOutline(blocks);
		expect(o.headings).toEqual([{ id: "h", level: 1, text: "Report" }]);
		expect(o.tables).toEqual([{ id: "t", rows: 2, columns: 2, headerRows: 1 }]);
		expect(o.pictures).toEqual([{ id: "i1", description: "Sales by month" }, { id: "i2", description: null }]);
		expect(o.links).toEqual([{ text: "the accounts", href: "https://example.com/a" }]);
		expect(o.paragraphs).toBe(3);
		expect(o.words).toBe(11);
	});

	it("carries the changes and comments the caller gives, and the accessibility problems", () => {
		const o = documentOutline(blocks, { trackedChanges: [{ kind: "insertion", author: "Ana", date: "2026-10-30", text: "new" }], comments: [{ author: "Ben", text: "check", resolved: false }] });
		expect(o.trackedChanges).toHaveLength(1);
		expect(o.comments[0].author).toBe("Ben");
		expect(o.accessibility.map((p) => p.kind)).toEqual(["picture"]);
	});

	it("is plain data: it survives being written as JSON and read back", () => {
		const o = documentOutline(blocks);
		expect(JSON.parse(JSON.stringify(o))).toEqual(o);
	});

	it("is empty for an empty document", () => {
		expect(documentOutline([])).toMatchObject({ words: 0, paragraphs: 0, headings: [], tables: [], pictures: [], links: [] });
	});
});
