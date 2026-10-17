import { describe, expect, it } from "vitest";

import { headingsOf, replaceInBlocks, textOfBlocks, type BlockLike } from "./documentFind";

const text = (t: string, styles = {}) => ({ type: "text" as const, text: t, styles });
const doc: BlockLike[] = [
	{ id: "1", type: "heading", content: [text("Cat story")], children: [{ id: "1a", type: "paragraph", content: [text("The cat sat. "), text("CAT", { bold: true })] }] },
	{ id: "2", type: "paragraph", content: [{ type: "link", href: "https://x.test", content: [text("a cat link")] }] },
	{ id: "3", type: "table", content: { type: "tableContent", rows: [{ cells: [[text("cat")], { type: "tableCell", content: [text("dog")] }] }] } },
];

describe("documentFind", () => {
	it("counts matches in text, links, tables and nested blocks, ignoring case unless asked not to", () => {
		expect(replaceInBlocks(doc, "cat", null, false).count).toBe(5);
		expect(replaceInBlocks(doc, "cat", null, true).count).toBe(3);
		expect(replaceInBlocks(doc, "", null, false).count).toBe(0);
		expect(replaceInBlocks(doc, "a.b", null, false).count).toBe(0);
	});

	it("replaces every match, keeping the styles of the run, and says which blocks changed", () => {
		const r = replaceInBlocks(doc, "cat", "dog", false);
		expect(r.count).toBe(5);
		expect(r.changed.map((c) => c.id)).toEqual(["1", "1a", "2", "3"]);
		const nested = r.changed.find((c) => c.id === "1a")!.content as { text: string; styles: unknown }[];
		expect(nested.map((x) => x.text)).toEqual(["The dog sat. ", "dog"]);
		expect(nested[1].styles).toEqual({ bold: true });
		const table = r.changed.find((c) => c.id === "3")!.content as { rows: { cells: unknown[] }[] };
		expect(JSON.stringify(table.rows[0].cells)).toContain('"dog"');
		expect(JSON.stringify(table.rows[0].cells)).not.toContain("cat");
	});

	it("takes the replacement literally, dollar signs included", () => {
		const r = replaceInBlocks([{ id: "x", type: "paragraph", content: [text("price")] }], "price", "$1 & $&", false);
		expect((r.changed[0].content as { text: string }[])[0].text).toBe("$1 & $&");
	});

	it("reads the text and the headings", () => {
		expect(textOfBlocks(doc)).toBe("Cat story\nThe cat sat. CAT\na cat link\ncat\tdog");
		expect(headingsOf([{ ...doc[0], props: { level: 2 } } as BlockLike, { id: "e", type: "heading", content: [] }])).toEqual([
			{ id: "1", level: 2, text: "Cat story" },
			{ id: "e", level: 1, text: "(empty heading)" },
		]);
	});
});

describe("whole-word replacement", () => {
	it("changes a word where it stands alone and not inside longer words", () => {
		const blocks: BlockLike[] = [{ id: "a", type: "paragraph", content: [{ type: "text", text: "teh tether, teh. Teh café", styles: {} }] }];
		const r = replaceInBlocks(blocks, "teh", "the", false, true);
		expect(r.count).toBe(3);
		expect((r.changed[0].content as { text: string }[])[0].text).toBe("the tether, the. the café");
		expect(replaceInBlocks(blocks, "caf", "x", false, true).count).toBe(0);
	});
});
