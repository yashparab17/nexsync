import { describe, expect, it } from "vitest";

import { autoCorrect, forFile, nextCaption, smartQuote, sortTable, tocBlocks } from "@/features/office/documents/lib/documentTools";

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
		expect(autoCorrect("plain", "x")).toBeNull();
	});
	it("prepares html for the file writers", () => {
		const out = forFile('<img src="x.png" data-text-alignment="center"><p data-page-break-before="true">a</p>');
		expect(out).toContain("<p style=\"text-align: center;\"><img");
		expect(out).toContain("page-break-before: always");
		expect(forFile("<p>plain</p>")).toBe("<p>plain</p>");
	});
});
