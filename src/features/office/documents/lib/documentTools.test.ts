import { describe, expect, it } from "vitest";

import { autoCorrect, autoCorrectOn, setAutoCorrect, forFile, nextCaption, smartQuote, sortTable, tocBlocks } from "@/features/office/documents/lib/documentTools";

const t = (vals: string[], headerRows = 1) => ({ type: "tableContent" as const, headerRows, rows: vals.map((v) => ({ cells: [v, "x"] })) });

describe("document tools", () => {
	it("sorts below the header, numbers as numbers", () => {
		const r = sortTable(t(["N", "10", "9", "100"]), 0, true).rows.map((x) => x.cells[0]);
		expect(r).toEqual(["N", "9", "10", "100"]);
		expect(sortTable(t(["N", "b", "a"]), 0, false).rows.map((x) => x.cells[0])).toEqual(["N", "b", "a"]);
	});
	it("builds contents and captions", () => {
		expect(tocBlocks([{ level: 2, text: "A" }])).toHaveLength(2);
		expect(nextCaption(["Figure 1: a", "Figure 2: b", "Table 1"], "Figure")).toBe("Figure 3: ");
	});
	it("curls quotes", () => {
		expect(smartQuote('"', "")).toBe("\u201c");
		expect(smartQuote("'", "don")).toBe("\u2019");
		expect(smartQuote('"', "said ")).toBe("\u201c");
		expect(smartQuote('"', "word")).toBe("\u201d");
	});
	it("corrects as you type", () => {
		expect(autoCorrect("a (c", ")")).toEqual({ remove: 2, insert: "©" });
		expect(autoCorrect("wait -", "-")).toEqual({ remove: 1, insert: "—" });
		expect(autoCorrect("wait..", ".")).toEqual({ remove: 2, insert: "…" });
		expect(autoCorrect("a-", ">")).toEqual({ remove: 1, insert: "→" });
	});

	it("marks a styled paragraph with its style id for the file writer: in the text of a paragraph, a heading and a list item", () => {
		const out = forFile('<p data-style-id="Callout">Look</p><h2 data-level="2" data-style-id="Heading2">Part</h2><ul><li data-style-id="ListParagraph"><p class="bn-inline-content">item</p></li></ul><p>plain</p><p data-style-id="">none</p>');
		const d = new DOMParser().parseFromString(out, "text/html");
		const texts = [...d.body.querySelectorAll("p, h2")].map((e) => e.textContent);
		expect(texts).toEqual(["CalloutLook", "Heading2Part", "ListParagraphitem", "plain", "none"]);
		expect(d.body.querySelector("li")?.textContent).toBe("ListParagraphitem");
	});

	it("leaves a picture, and an id that holds a marker character, alone", () => {
		const out = forFile('<img data-style-id="Pic" src="x.png"><p data-style-id="ab">x</p>');
		expect(out).not.toMatch(/Pic|Pic/);
		expect(new DOMParser().parseFromString(out, "text/html").body.querySelector("p")?.textContent).toBe("x");
	});

	it("puts a slip right after the word, keeping the capitals and the space that was typed", () => {
		expect(autoCorrect("so teh", " ")).toEqual({ remove: 3, insert: "the " });
		expect(autoCorrect("so Teh", " ")).toEqual({ remove: 3, insert: "The " });
		expect(autoCorrect("so TEH", " ")).toEqual({ remove: 3, insert: "THE " });
		expect(autoCorrect("we recieve", ".")).toEqual({ remove: 7, insert: "receive." });
		expect(autoCorrect("I dont", " ")).toEqual({ remove: 4, insert: "don't " });
		expect(autoCorrect("it is alot", " ")).toEqual({ remove: 4, insert: "a lot " });
	});

	it("makes two capitals one and a lone i a capital, but leaves plurals, names and acronyms", () => {
		expect(autoCorrect("see THe", " ")).toEqual({ remove: 3, insert: "The " });
		expect(autoCorrect("two PCs", " ")).toBeNull();
		expect(autoCorrect("the NASA", " ")).toBeNull();
		expect(autoCorrect("so i", " ")).toEqual({ remove: 1, insert: "I " });
		expect(autoCorrect("so i", "'")).toEqual({ remove: 1, insert: "I'" });
		expect(autoCorrect("see i.e", ".")).toBeNull();
		expect(autoCorrect("my iPhone", " ")).toBeNull();
	});

	it("starts a sentence with a capital, but not after an abbreviation, a number, a comma or inside an address", () => {
		expect(autoCorrect("Hello. world", " ")).toEqual({ remove: 5, insert: "World " });
		expect(autoCorrect("Really? yes", " ")).toEqual({ remove: 3, insert: "Yes " });
		expect(autoCorrect("hello", " ")).toEqual({ remove: 5, insert: "Hello " });
		expect(autoCorrect("see e.g. next", " ")).toBeNull();
		expect(autoCorrect("Version 3. next", " ")).toBeNull();
		expect(autoCorrect("hello, world", " ")).toBeNull();
		expect(autoCorrect("https://example.com/page", " ")).toBeNull();
		expect(autoCorrect("write to me@site", " ")).toBeNull();
		expect(autoCorrect("a slip. teh", " ")).toEqual({ remove: 3, insert: "The " });
		expect(autoCorrect("Fine.", " ")).toBeNull();
		expect(autoCorrect("plain", "x")).toBeNull();
	});
	it("prepares html for the file writers", () => {
		const out = forFile('<img src="x.png" data-text-alignment="center"><p data-page-break-before="true">a</p>');
		expect(out).toContain("<p style=\"text-align: center;\"><img");
		expect(out).toContain("page-break-before: always");
		expect(forFile("<p>plain</p>")).toBe("<p>plain</p>");
	});
});

describe("turning AutoCorrect off", () => {
	it("is on until a person turns it off, and the choice is kept", () => {
		localStorage.removeItem("docAutoCorrect");
		expect(autoCorrectOn()).toBe(true);
		setAutoCorrect(false);
		expect(autoCorrectOn()).toBe(false);
		setAutoCorrect(true);
		expect(autoCorrectOn()).toBe(true);
	});
});

describe("a paragraph that starts a section", () => {
	it("carries its set-up as a marker, after which the style's marker stands first", () => {
		const out = forFile('<p data-section-break="next|l||2" data-style-id="Callout">Text</p><p>Plain</p>');
		expect(out).toBe('<p data-section-break="next|l||2" data-style-id="Callout">Calloutnext|l||2Text</p><p>Plain</p>');
	});
});

