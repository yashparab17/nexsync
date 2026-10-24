import { describe, expect, it } from "vitest";

import { changeCase, countText, DEFAULT_PAGE, fontStack, pageBox, pageCount, pointsOf, readHeaderFooter, readPage, stepSize, styleOf } from "@/features/office/documents/lib/documentFormat";

describe("documentFormat", () => {
	it("steps a size up and down the list the way Grow and Shrink do", () => {
		expect(stepSize(11, 1)).toBe(12);
		expect(stepSize(11, -1)).toBe(10.5);
		expect(stepSize(72, 1)).toBe(82);
		expect(stepSize(8, -1)).toBe(7);
		expect(stepSize(1, -1)).toBe(1);
		expect(stepSize(13, 1)).toBe(14);
		expect(stepSize(13, -1)).toBe(12);
	});

	it("reads a size written as points or as a number", () => {
		expect(pointsOf("14pt")).toBe(14);
		expect(pointsOf("10.5")).toBe(10.5);
		expect(pointsOf("1em")).toBeNull();
		expect(pointsOf(undefined)).toBeNull();
	});

	it("finds the page in points, turned on its side for landscape, with the margins of the preset", () => {
		expect(pageBox(DEFAULT_PAGE)).toEqual({ width: 612, height: 792, top: 72, right: 72, bottom: 72, left: 72 });
		const a4 = pageBox({ ...DEFAULT_PAGE, paper: "a4", landscape: true, margins: "narrow" });
		expect(a4).toMatchObject({ width: 841.9, height: 595.3, left: 36 });
		expect(pageBox({ ...DEFAULT_PAGE, margins: "wide" }).left).toBe(144);
	});

	it("keeps what is valid in a stored setup", () => {
		expect(readPage(null)).toEqual(DEFAULT_PAGE);
		expect(readPage({ paper: "a4", landscape: true, margins: "wide", columns: 2, spacing: 2 })).toEqual({ paper: "a4", landscape: true, margins: "wide", columns: 2, spacing: 2, valign: "top" });
		expect(readPage({ paper: "tabloid", margins: 5, columns: 9, spacing: 99 })).toEqual(DEFAULT_PAGE);
		expect(readHeaderFooter({ header: "H", footer: 5, pageNumbers: true })).toEqual({ header: "H", footer: "", pageNumbers: true });
		expect(readHeaderFooter("x").header).toBe("");
	});

	it("counts pages from the height of the body", () => {
		const box = pageBox(DEFAULT_PAGE);
		// A Letter page with one-inch margins has 9 inches = 864 px of room
		expect(pageCount(0, box)).toBe(1);
		expect(pageCount(864, box)).toBe(1);
		expect(pageCount(865, box)).toBe(2);
		expect(pageCount(2600, box)).toBe(4);
	});

	it("counts words, characters and paragraphs", () => {
		expect(countText("")).toEqual({ words: 0, characters: 0, charactersNoSpaces: 0, paragraphs: 0 });
		expect(countText("Hello  big world\n\nSecond paragraph")).toEqual({ words: 5, characters: 32, charactersNoSpaces: 28, paragraphs: 2 });
	});

	it("names the style of a block", () => {
		expect(styleOf({ type: "heading", props: { level: 2 } })).toBe("h2");
		expect(styleOf({ type: "heading", props: { level: 5 } })).toBe("h1");
		expect(styleOf({ type: "paragraph" })).toBe("normal");
		expect(styleOf({ type: "quote" })).toBe("quote");
		expect(styleOf(undefined)).toBe("normal");
	});

	it("falls back to a generic stack for a font it does not know", () => {
		expect(fontStack("Georgia")).toContain("serif");
		expect(fontStack("Zapfino")).toBe("'Zapfino', sans-serif");
	});
});

describe("changeCase", () => {
	it("changes the case of a selection", () => {
		expect(changeCase("hello wORLD. it's me! ok", "upper")).toBe("HELLO WORLD. IT'S ME! OK");
		expect(changeCase("Hello WORLD", "lower")).toBe("hello world");
		expect(changeCase("hello wORLD it's me", "title")).toBe("Hello World It's Me");
		expect(changeCase("hello wORLD. it's me! ok", "sentence")).toBe("Hello world. It's me! Ok");
	});
});

describe("watermark", () => {
	it("is kept when valid and trimmed to forty characters", () => {
		expect(readPage({ watermark: "  DRAFT " }).watermark).toBe("DRAFT");
		expect(readPage({ watermark: "x".repeat(60) }).watermark).toHaveLength(40);
		expect(readPage({ watermark: " " }).watermark).toBeUndefined();
	});
});

describe("line numbers", () => {
	it("are a stored page setting that is off unless set", () => {
		expect(readPage({ lineNumbers: true }).lineNumbers).toBe(true);
		expect(readPage({ lineNumbers: "yes" }).lineNumbers).toBeUndefined();
	});
});
