import { describe, expect, it } from "vitest";

import { buildPdf, encode, parseBlocks, wrap } from "./pdf";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("buildPdf", () => {
	it("writes a well-formed file whose cross-reference offsets point at their objects", () => {
		const pdf = text(buildPdf("Notes", "# Title\n\nSome text with (parentheses) and a back\\slash.\n", true));
		expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
		expect(pdf.endsWith("%%EOF\n")).toBe(true);

		const start = Number(/startxref\n(\d+)/.exec(pdf)![1]);
		expect(pdf.slice(start, start + 4)).toBe("xref");
		const entries = [...pdf.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
		entries.forEach((offset, index) => expect(pdf.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true));
		expect(pdf).toContain("\\(parentheses\\)");
		expect(pdf).toContain("back\\\\slash");
	});

	it("adds pages as the text grows and numbers them", () => {
		const long = Array.from({ length: 200 }, (_, i) => `Line number ${i}`).join("\n");
		const pdf = text(buildPdf("Long", long, false));
		const pages = Number(/\/Type \/Pages \/Count (\d+)/.exec(pdf)![1]);
		expect(pages).toBeGreaterThan(2);
		expect(pdf).toContain(`(${pages} / ${pages})`);
	});

	it("gives an empty note one page", () => {
		expect(text(buildPdf("Empty", "", true))).toContain("/Count 1");
	});
});

describe("encode", () => {
	it("keeps Latin-1 and typographic characters, and drops what the fonts lack", () => {
		expect(encode("caf\u00e9")).toEqual([99, 97, 102, 0xe9]);
		expect(encode("\u201cq\u201d \u2014")).toEqual([0x93, 113, 0x94, 32, 0x97]);
		expect(encode("\u4e2d")).toEqual([63]);
		expect(encode("\u0101")).toEqual([97]);
	});
});

describe("wrap", () => {
	it("breaks at spaces and inside words that are too long", () => {
		const lines = wrap("alpha beta gamma delta", "F1", 11, 60);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.join(" ")).toBe("alpha beta gamma delta");
		expect(wrap("x".repeat(200), "F1", 11, 100).length).toBeGreaterThan(1);
	});
});

describe("parseBlocks", () => {
	it("reads Markdown structure", () => {
		const blocks = parseBlocks("# H\nline one\nline two\n\n- item **bold**\n1. first\n- [x] done\n> quote\n```\ncode()\n```\n---", true);
		expect(blocks.map((b) => b.kind)).toEqual(["h1", "p", "gap", "li", "li", "li", "quote", "code", "rule"]);
		expect(blocks[1].text).toBe("line one line two");
		expect(blocks[3].text).toBe("item bold");
		expect(blocks[5].text).toBe("[x] done");
	});

	it("keeps the lines of plain text", () => {
		expect(parseBlocks("# not a heading\n\nnext", false).map((b) => b.kind)).toEqual(["p", "gap", "p"]);
	});
});
