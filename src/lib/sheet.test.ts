import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { a1Of, addSheet, colLetters, deleteSheet, extent, freezeOf, lettersCol, listSheets, lookOf, normalise, parseA1, parseTsv, rangeText, readWorkbook, renameSheet, replaceWorkbook, seed, setCell, setFreeze, setWidth, stepDecimals, styleRange, toTsv, typedText, widthsFor } from "./sheet";

describe("sheet addresses", () => {
	it("count columns the way spreadsheets do", () => {
		expect([0, 1, 25, 26, 27, 51, 52, 701, 702, 16383].map(colLetters)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA", "XFD"]);
		expect(["A", "Z", "AA", "XFD"].map(lettersCol)).toEqual([0, 25, 26, 16383]);
		expect(a1Of(0, 0)).toBe("A1");
		expect(parseA1("c12")).toEqual({ row: 11, col: 2 });
		expect(parseA1("A0")).toBeNull();
		expect(parseA1("12")).toBeNull();
		expect(parseA1("XFE1")).toBeNull();
		expect(rangeText(normalise({ row: 4, col: 3 }, { row: 1, col: 0 }))).toBe("A2:D5");
		expect(rangeText(normalise({ row: 2, col: 2 }, { row: 2, col: 2 }))).toBe("C3");
	});
});

describe("the shared workbook", () => {
	it("is filled from a file once, and cells are typed and cleared", () => {
		const doc = new Y.Doc();
		expect(seed(doc, [{ name: "Data", cells: { A1: "1", B2: "=A1*2" } }])).toBe(true);
		expect(seed(doc, [{ name: "Other", cells: {} }])).toBe(false);
		const [sheet] = listSheets(doc);
		expect(sheet.name).toBe("Data");
		expect(typedText(doc, sheet.id, "B2")).toBe("=A1*2");
		setCell(doc, sheet.id, "C3", "hello");
		setCell(doc, sheet.id, "A1", "");
		expect(readWorkbook(doc)).toEqual([{ name: "Data", cells: { B2: "=A1*2", C3: "hello" } }]);
	});

	it("keeps two people's different cells and takes the engine's rewrite of the rest", () => {
		const a = new Y.Doc();
		seed(a, [{ name: "S", cells: { A1: "1" } }]);
		const b = new Y.Doc();
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
		const id = listSheets(a)[0].id;
		setCell(a, id, "A2", "from a");
		setCell(b, id, "B1", "from b");
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
		expect(readWorkbook(a)).toEqual(readWorkbook(b));
		expect(readWorkbook(a)[0].cells).toEqual({ A1: "1", A2: "from a", B1: "from b" });
		replaceWorkbook(a, [{ name: "S", cells: { A1: "1", A3: "from a", B1: "from b" } }]);
		expect(readWorkbook(a)[0].cells).toEqual({ A1: "1", A3: "from a", B1: "from b" });
	});

	it("adds, renames and deletes sheets, refusing bad names and the last sheet", () => {
		const doc = new Y.Doc();
		seed(doc, []);
		const first = listSheets(doc)[0];
		expect(first.name).toBe("Sheet1");
		const second = addSheet(doc);
		expect(second.name).toBe("Sheet2");
		expect(renameSheet(doc, second.id, "Costs")).toBeNull();
		expect(renameSheet(doc, second.id, "sheet1")).toMatch(/Another sheet/);
		expect(renameSheet(doc, second.id, "a/b")).toMatch(/none of/);
		expect(renameSheet(doc, second.id, "x".repeat(32))).toMatch(/1 to 31/);
		setCell(doc, second.id, "A1", "x");
		expect(deleteSheet(doc, second.id)).toBeNull();
		expect(readWorkbook(doc)).toHaveLength(1);
		expect(Object.keys(Object.fromEntries(doc.getMap("cells").entries()))).toEqual([]);
		expect(deleteSheet(doc, first.id)).toMatch(/at least one/);
	});
});

describe("the clipboard", () => {
	it("reads what spreadsheets copy, with quotes, tabs and line breaks inside cells", () => {
		expect(parseTsv("a\tb\n1\t2\n")).toEqual([["a", "b"], ["1", "2"]]);
		expect(parseTsv('"x\ty"\t"line1\nline2"\t"say ""hi"""')).toEqual([["x\ty", "line1\nline2", 'say "hi"']]);
		expect(parseTsv("a\t\tc")).toEqual([["a", "", "c"]]);
		expect(parseTsv("")).toEqual([]);
		expect(toTsv([["a", "b"], ["c"]])).toBe("a\tb\nc");
	});

	it("finds the extent of the used cells", () => {
		expect(extent({ A1: 1, C7: 2 })).toEqual({ rows: 7, cols: 3 });
		expect(extent({})).toEqual({ rows: 0, cols: 0 });
	});
});

describe("how cells look", () => {
	it("is kept per cell, merged on each change, and rides along to the engine", () => {
		const doc = new Y.Doc();
		seed(doc, [{ name: "S", cells: { A1: "1" } }]);
		const [s] = listSheets(doc);
		styleRange(doc, s.id, { r0: 0, c0: 0, r1: 1, c1: 0 }, (c) => ({ ...c, bold: true }));
		styleRange(doc, s.id, { r0: 0, c0: 0, r1: 0, c1: 0 }, (c) => ({ ...c, fill: "#FFFF00" }));
		expect(lookOf(doc, s.id, "A1")).toEqual({ bold: true, fill: "#FFFF00" });
		expect(lookOf(doc, s.id, "A2")).toEqual({ bold: true });
		setWidth(doc, s.id, 1, 140);
		setFreeze(doc, s.id, 1, 0);
		expect(readWorkbook(doc)[0]).toEqual({ name: "S", cells: { A1: "1" }, styles: { A1: { bold: true, fill: "#FFFF00" }, A2: { bold: true } }, widths: { B: 140 }, freeze: [1, 0] });
		// Turning every look off leaves nothing behind
		styleRange(doc, s.id, { r0: 0, c0: 0, r1: 1, c1: 0 }, () => ({}));
		expect(readWorkbook(doc)[0].styles).toBeUndefined();
		setFreeze(doc, s.id, 0, 0);
		expect(freezeOf(doc, s.id)).toEqual([0, 0]);
	});

	it("is filled from a file and follows the engine's moves", () => {
		const doc = new Y.Doc();
		seed(doc, [{ name: "S", cells: { A1: "x" }, styles: { A1: { italic: true } }, widths: { C: 90 }, freeze: [0, 1] }]);
		const [s] = listSheets(doc);
		expect(lookOf(doc, s.id, "A1")).toEqual({ italic: true });
		expect(widthsFor(doc, s.id)).toEqual({ 2: 90 });
		expect(freezeOf(doc, s.id)).toEqual([0, 1]);
		replaceWorkbook(doc, [{ name: "S", cells: { A2: "x" }, styles: { A2: { italic: true } } }]);
		expect(lookOf(doc, s.id, "A1")).toEqual({});
		expect(lookOf(doc, s.id, "A2")).toEqual({ italic: true });
	});

	it("steps the decimals of a number format", () => {
		expect(stepDecimals(undefined, 1)).toBe("0.0");
		expect(stepDecimals("0.00", 1)).toBe("0.000");
		expect(stepDecimals("0.00", -1)).toBe("0.0");
		expect(stepDecimals("0.0", -1)).toBe("0");
		expect(stepDecimals("0", -1)).toBe("0");
		expect(stepDecimals('"$"#,##0.00', -1)).toBe('"$"#,##0.0');
		expect(stepDecimals("0.0%", 1)).toBe("0.00%");
	});
});
