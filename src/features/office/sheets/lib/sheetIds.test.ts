import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { addSheet, cellsOf, deleteColumns, deleteRows, insertColumns, insertRows, listSheets, lookOf, readWorkbook, replaceWorkbook, seed, setCell, setWidth, styleRange, typedText, widthsFor } from "@/features/office/sheets/lib/sheet";

const sync = (a: Y.Doc, b: Y.Doc) => {
	Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
	Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
};

// Two devices holding the same workbook
function pair(cells: Record<string, string>) {
	const a = new Y.Doc();
	seed(a, [{ name: "Sheet1", cells }]);
	const b = new Y.Doc();
	Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
	return { a, b, id: listSheets(a)[0].id };
}

describe("rows and columns that keep their identity", () => {
	it("keeps a number where its author put it when somebody inserts a row at the same time", () => {
		// The case that failed in the study: one inserts a row above row 2, the other types over the 3
		const { a, b, id } = pair({ A1: "1", A2: "2", A3: "3", A4: "4" });
		insertRows(a, id, 1, 1);
		setCell(b, id, "A3", "999");
		sync(a, b);
		for (const d of [a, b]) {
			expect(["A1", "A2", "A3", "A4", "A5"].map((c) => typedText(d, id, c))).toEqual(["1", "", "2", "999", "4"]);
		}
	});

	it("makes a formula follow the cells it names, also one typed while the row was inserted", () => {
		const { a, b, id } = pair({ A1: "1", A2: "2", A3: "3", B1: "=A3" });
		insertRows(a, id, 1, 2);
		setCell(b, id, "C1", "=A3+A2");
		sync(a, b);
		for (const d of [a, b]) {
			expect(typedText(d, id, "B1")).toBe("=A5");
			expect(typedText(d, id, "C1")).toBe("=A5+A4");
		}
	});

	it("keeps both rows when two people insert at the same place", () => {
		const { a, b, id } = pair({ A1: "x", A2: "y" });
		insertRows(a, id, 1, 1);
		insertRows(b, id, 1, 1);
		sync(a, b);
		setCell(a, id, "A5", "end");
		expect(readWorkbook(a)[0].cells).toEqual({ A1: "x", A4: "y", A5: "end" });
		expect(readWorkbook(b)[0].cells.A4).toBe("y");
	});

	it("shows #REF! for a cell whose row was deleted, and shrinks a range that loses rows", () => {
		const { a, id } = pair({ A1: "1", A2: "2", A3: "3", A4: "4", B1: "=A3", C1: "=SUM(A1:A4)", D1: "=SUM(A2:A3)" });
		deleteRows(a, id, 3, 1);
		expect(typedText(a, id, "C1")).toBe("=SUM(A1:A3)");
		deleteRows(a, id, 1, 2);
		expect(typedText(a, id, "B1")).toBe("=#REF!");
		expect(typedText(a, id, "C1")).toBe("=SUM(A1:A1)");
		expect(typedText(a, id, "D1")).toBe("=SUM(#REF!)");
		expect(readWorkbook(a)[0].cells).toEqual({ A1: "1", B1: "=#REF!", C1: "=SUM(A1:A1)", D1: "=SUM(#REF!)" });
	});

	it("does not show what somebody typed into a row that another person deleted", () => {
		const { a, b, id } = pair({ A1: "1", A2: "2", A3: "3" });
		deleteRows(a, id, 1, 1);
		setCell(b, id, "A2", "typed");
		sync(a, b);
		for (const d of [a, b]) expect(readWorkbook(d)[0].cells).toEqual({ A1: "1", A2: "3" });
	});

	it("moves looks and column widths with their columns", () => {
		const doc = new Y.Doc();
		seed(doc, [{ name: "S", cells: { A1: "x", B1: "y" }, widths: { B: 150 } }]);
		const id = listSheets(doc)[0].id;
		styleRange(doc, id, { r0: 0, c0: 1, r1: 0, c1: 1 }, (c) => ({ ...c, bold: true }));
		insertColumns(doc, id, 0, 1);
		expect(lookOf(doc, id, "C1").bold).toBe(true);
		expect(lookOf(doc, id, "B1").bold).toBeUndefined();
		expect(widthsFor(doc, id)).toEqual({ 2: 150 });
		setWidth(doc, id, 0, 80);
		expect(readWorkbook(doc)[0].widths).toEqual({ A: 80, C: 150 });
		deleteColumns(doc, id, 0, 1);
		expect(readWorkbook(doc)[0].cells).toEqual({ A1: "x", B1: "y" });
	});

	it("leaves quoted text and function names alone", () => {
		const { a, id } = pair({ A1: "5", B1: '=IF(A1>0,"A1 is B2","C3")', C1: "=LOG10(A1)+ROUND(A1,2)" });
		insertRows(a, id, 0, 1);
		expect(typedText(a, id, "B2")).toBe('=IF(A2>0,"A1 is B2","C3")');
		expect(typedText(a, id, "C2")).toBe("=LOG10(A2)+ROUND(A2,2)");
	});

	it("follows a name written with another sheet's name when rows are inserted in that sheet", () => {
		const doc = new Y.Doc();
		seed(doc, [{ name: "Data", cells: { A1: "10", A2: "20" } }, { name: "Report", cells: { A1: "=Data!A2*2" } }]);
		const [data, report] = listSheets(doc);
		insertRows(doc, data.id, 0, 3);
		expect(typedText(doc, report.id, "A1")).toBe("=Data!A5*2");
	});

	it("reads a document whose cells were stored under addresses, and moves it to ids", () => {
		const doc = new Y.Doc();
		doc.getArray("sheets").push([{ id: "s1", name: "Old" }]);
		const cells = cellsOf(doc);
		cells.set("s1!A1", "1");
		cells.set("s1!B2", "=A1+5");
		doc.getMap("looks").set("s1!A1", JSON.stringify({ bold: true }));
		doc.getMap("widths").set("s1!B", 120);
		expect(readWorkbook(doc)[0]).toMatchObject({ cells: { A1: "1", B2: "=A1+5" }, styles: { A1: { bold: true } }, widths: { B: 120 } });
		expect([...cellsOf(doc).keys()].every((k) => k.includes("."))).toBe(true);
		insertRows(doc, "s1", 0, 1);
		expect(readWorkbook(doc)[0].cells).toEqual({ A2: "1", B3: "=A2+5" });
	});

	it("adds a sheet and deletes one without leaving anything of it", () => {
		const doc = new Y.Doc();
		seed(doc, [{ name: "A", cells: { A1: "1" } }]);
		const extra = addSheet(doc);
		setCell(doc, extra.id, "B2", "z");
		insertRows(doc, extra.id, 0, 1);
		expect(typedText(doc, extra.id, "B3")).toBe("z");
		replaceWorkbook(doc, [{ name: "A", cells: { A1: "1" } }, { name: extra.name, cells: { B3: "y", C3: "w" } }]);
		expect(readWorkbook(doc)[1].cells).toEqual({ B3: "y", C3: "w" });
	});
});
