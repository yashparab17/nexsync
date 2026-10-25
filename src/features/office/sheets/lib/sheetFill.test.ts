import { describe, expect, it } from "vitest";

import { normalise } from "@/features/office/sheets/lib/sheet";
import { extendRange, learnTransform, pivotAcross, TABLE_STYLES, tableLook } from "@/features/office/sheets/lib/sheetFill";

describe("sheet fill, flash fill and tables", () => {
	it("extends a selection by dragging the handle", () => {
		const cells: Record<string, string> = { A1: "1", A2: "2", B1: "=A1*2", C1: "Item 1" };
		const at = (a: string) => cells[a] ?? "";
		expect(extendRange(normalise({ row: 0, col: 0 }, { row: 1, col: 0 }), { row: 4, col: 0 }, at).map((c) => c.text)).toEqual(["3", "4", "5"]);
		expect(extendRange(normalise({ row: 0, col: 1 }, { row: 0, col: 1 }), { row: 2, col: 1 }, at)).toEqual([
			{ a1: "B2", text: "=A2*2" },
			{ a1: "B3", text: "=A3*2" },
		]);
		expect(extendRange(normalise({ row: 0, col: 2 }, { row: 0, col: 2 }), { row: 1, col: 2 }, at)[0].text).toBe("Item 2");
		expect(extendRange(normalise({ row: 0, col: 0 }, { row: 0, col: 0 }), { row: 0, col: 0 }, at)).toEqual([]);
	});
	it("learns from examples", () => {
		expect(learnTransform([["Ana Smith", "Smith"]])?.("Bo Jones")).toBe("Jones");
		expect(learnTransform([["Ana Smith", "AS"]])?.("Bo Jones")).toBe("BJ");
		expect(learnTransform([["ana@x.org", "ana"]])?.("bo@y.com")).toBe("bo");
		expect(learnTransform([["ana", "Dr. ana!"]])?.("bo")).toBe("Dr. bo!");
		expect(learnTransform([["Smith, Ana", "Smi"]])?.("Jones, Bo")).toBe("Jon");
		expect(learnTransform([["a", "zzz"], ["b", "qqq"]])).toBeNull();
	});
	it("summarises across two columns", () => {
		const rows = [["Region", "Q", "Sales"], ["N", "Q1", "10"], ["N", "Q2", "20"], ["S", "Q1", "5"]];
		expect(pivotAcross(rows, 0, 1, 2, "sum")).toEqual([
			["Sum of Sales", "Q1", "Q2", "Total"],
			["N", "10", "20", "30"],
			["S", "5", "", "5"],
			["Total", "15", "20", "35"],
		]);
	});
	it("styles table rows", () => {
		expect(tableLook(0, TABLE_STYLES[0], false).bold).toBe(true);
		expect(tableLook(2, TABLE_STYLES[0], false).fill).toBe(TABLE_STYLES[0].band);
		expect(tableLook(1, TABLE_STYLES[0], false).fill).toBeUndefined();
	});
});
