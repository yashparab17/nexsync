import { describe, expect, it } from "vitest";

import { blocksToPlainText, markdownStats, plainTextToBlocks, textStats } from "./text";

describe("textStats", () => {
	it("counts lines the way an editor numbers them", () => {
		expect(textStats("").lines).toBe(0);
		expect(textStats("one").lines).toBe(1);
		expect(textStats("one\ntwo").lines).toBe(2);
		expect(textStats("one\ntwo\n").lines).toBe(2); // a trailing line break adds no line
		expect(textStats("one\n\nthree\n").lines).toBe(3); // blank lines in the middle do
		expect(textStats("one\r\ntwo\r\n").lines).toBe(2);
	});

	it("counts words, keeping contractions and hyphenated words whole", () => {
		expect(textStats("").words).toBe(0);
		expect(textStats("  \n \n").words).toBe(0);
		expect(textStats("Hello, world!").words).toBe(2);
		expect(textStats("don't well-known café 你好 42").words).toBe(5);
		expect(textStats("a - b").words).toBe(2); // a lone dash is not a word
	});
});

describe("markdownStats", () => {
	it("does not count markup as words", () => {
		const md = "# Title\n\n- **bold** item\n- [a link](https://example.com)\n\n> quoted words\n\n---\n";
		expect(markdownStats(md).words).toBe(7); // Title bold item a link quoted words
		expect(markdownStats(md).lines).toBe(8);
	});

	it("counts the code inside fences but not the fences", () => {
		expect(markdownStats("```js\nconst a = 1;\n```\n").words).toBe(3);
	});

	it("keeps image alt text and drops the address", () => {
		expect(markdownStats("![a red fox](fox.png)").words).toBe(3);
	});
});

describe("plain text and rich-text blocks", () => {
	it("turns each line into a paragraph and back", () => {
		const text = "first\n\nthird\n";
		expect(blocksToPlainText(plainTextToBlocks(text))).toBe(text);
	});

	it("writes list markers so lists stay readable", () => {
		const blocks = [
			{ type: "heading", content: [{ type: "text", text: "Groceries" }] },
			{ type: "bulletListItem", content: [{ type: "text", text: "milk" }] },
			{ type: "numberedListItem", content: [{ type: "text", text: "one" }] },
			{ type: "numberedListItem", content: [{ type: "text", text: "two" }] },
			{ type: "paragraph", content: [{ type: "link", content: [{ type: "text", text: "a link" }] }] },
		];
		expect(blocksToPlainText(blocks)).toBe("# Groceries\n- milk\n1. one\n2. two\na link\n");
	});

	it("ignores the empty block the editor keeps at the end", () => {
		expect(blocksToPlainText([{ type: "paragraph", content: [] }])).toBe("");
		expect(blocksToPlainText([{ type: "paragraph", content: [{ type: "text", text: "hi" }] }, { type: "paragraph", content: [] }])).toBe("hi\n");
	});

	it("keeps headings and their level through a round trip", () => {
		const text = "# Plan\n## Steps\n### Detail\nplain # not a heading\n";
		const blocks = plainTextToBlocks(text);
		expect(blocks.map((b) => b.type)).toEqual(["heading", "heading", "heading", "paragraph"]);
		expect(blocksToPlainText(blocks)).toBe(text);
	});
});
