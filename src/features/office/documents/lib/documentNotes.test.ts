import { describe, expect, it } from "vitest";

import { markReferences, nextNoteId, noteValue, notesToSend, parseNoteValue, referencesIn, withReferences, type NoteDef } from "@/features/office/documents/lib/documentNotes";

const m = (id: number) => `${id}`;

describe("footnotes and endnotes in the editor", () => {
	it("keeps the kind and number in the value of a reference", () => {
		expect(parseNoteValue(noteValue(true, 12))).toEqual({ end: true, id: 12 });
		expect(parseNoteValue("f1000001")).toEqual({ end: false, id: 1000001 });
		expect(parseNoteValue("x1")).toBeNull();
		expect(nextNoteId([])).toBe(1_000_001);
		expect(nextNoteId([5, 1_000_007])).toBe(1_000_008);
	});

	it("turns the markers of a file into references, in paragraphs and in table cells, keeping the text around them", () => {
		const blocks = [
			{ type: "paragraph", content: [{ type: "text", text: `A claim${m(3)} to check${m(4)}.`, styles: { bold: true } }] },
			{ type: "table", content: { type: "tableContent", rows: [{ cells: [[{ type: "text", text: `In a cell${m(3)}`, styles: {} }]] }] } },
		];
		const out = withReferences(blocks, [{ id: 3, end: false, text: "x" }, { id: 4, end: true, text: "y" }]) as unknown as { content: { text: string; styles: Record<string, unknown> }[] }[];
		expect(out[0].content.map((c) => c.text)).toEqual(["A claim", "*", " to check", "*", "."]);
		expect(out[0].content[1].styles).toEqual({ bold: true, note: "f3" });
		expect(out[0].content[3].styles.note).toBe("e4");
		expect(referencesIn(out as never)).toEqual([{ id: 3, end: false }, { id: 4, end: true }]);
	});

	it("sends the words of the notes the text still refers to, and no others", () => {
		const blocks = [{ type: "paragraph", content: [{ type: "text", text: "*", styles: { note: "f1000001" } }, { type: "text", text: "*", styles: { note: "e7" } }] }];
		const defs = new Map<number, NoteDef>([[1000001, { end: false, text: "New" }], [7, { end: true, text: "Old" }], [9, { end: false, text: "Gone" }]]);
		expect(notesToSend(blocks, defs)).toEqual([{ id: 1000001, end: false, text: "New" }, { id: 7, end: true, text: "Old" }]);
	});

	it("writes a reference into the HTML for the backend as its marker", () => {
		const html = '<p>See<span data-note="f12">*</span> this<span data-note="bad">*</span></p>';
		expect(markReferences(html)).toBe(`<p>See${m(12)} this</p>`);
	});
});
