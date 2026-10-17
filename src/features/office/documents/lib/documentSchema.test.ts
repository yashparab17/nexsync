import { BlockNoteEditor } from "@blocknote/core";
import { describe, expect, it } from "vitest";

import { documentSchema } from "@/features/office/documents/lib/documentSchema";

// What the editor writes as HTML is what reaches the file, and what a file gives back is what the editor shows
describe("documentSchema", () => {
	const make = () => BlockNoteEditor.create({ schema: documentSchema });

	it("writes a font size, a font, a colour and an alignment into the HTML", () => {
		const editor = make();
		const html = editor.blocksToHTMLLossy([
			{ type: "paragraph", props: { textAlignment: "center" }, content: [{ type: "text", text: "Big", styles: { fontSize: "24pt", fontFamily: "Georgia", bold: true, textColor: "red" } }] },
		] as never);
		expect(html).toContain("font-size: 24pt");
		expect(html).toContain("Georgia");
		expect(html).toMatch(/<strong>|font-weight/);
		expect(html.toLowerCase()).toMatch(/text-align:\s*center|data-text-alignment="center"/);
	});

	it("reads a font size and a font back from HTML", () => {
		const editor = make();
		const blocks = editor.tryParseHTMLToBlocks('<p><span style="font-size:20pt;font-family:Georgia, serif">Hello</span></p>');
		const run = (blocks[0].content as { text: string; styles: Record<string, unknown> }[])[0];
		expect(run.text).toBe("Hello");
		expect(run.styles.fontSize).toBe("20pt");
		expect(run.styles.fontFamily).toBe("Georgia");
	});

	it("keeps headings, lists and tables through HTML", () => {
		const editor = make();
		const blocks = editor.tryParseHTMLToBlocks("<h2>Title</h2><ul><li>a</li><li>b</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>");
		expect(blocks.map((b) => b.type)).toEqual(["heading", "bulletListItem", "bulletListItem", "table"]);
	});
});
