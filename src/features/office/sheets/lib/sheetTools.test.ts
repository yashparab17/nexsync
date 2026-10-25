import { describe, expect, it } from "vitest";

import { a1Of, normalise } from "@/features/office/sheets/lib/sheet";
import { cfLook, rangeStats, checkEntry, continueSeries, duplicateRows, fillRange, goalSeek, inRange, pivot, seriesRange, shiftFormula, splitText, type CfRule, type DvRule } from "@/features/office/sheets/lib/sheetTools";

const st = (lo: number, hi: number) => ({ ...rangeStats([]), lo, hi });
const rule = (r: Partial<CfRule>): CfRule => ({ id: "x", sheet: "s", range: "A1:A9", kind: "gt", a: "", b: "", color: "#f00", ...r });

describe("sheet tools", () => {
	it("moves formula references like a copy does", () => {
		expect(shiftFormula("=A1+$B$2+C$3", 1, 1)).toBe("=B2+$B$2+D$3");
		expect(shiftFormula('=SUM(A1:A3)&"A1"', 2, 0)).toBe('=SUM(A3:A5)&"A1"');
		expect(shiftFormula("plain", 1, 1)).toBe("plain");
		expect(shiftFormula("=Sheet2!A1", 1, 0)).toBe("=Sheet2!A2");
	});
	it("continues series", () => {
		expect(continueSeries(["1", "2"], 3)).toEqual(["3", "4", "5"]);
		expect(continueSeries(["5"], 2)).toEqual(["5", "5"]);
		expect(continueSeries(["Item 9"], 2)).toEqual(["Item 10", "Item 11"]);
		expect(continueSeries(["a", "b"], 3)).toEqual(["a", "b", "a"]);
	});
	it("fills down and right, moving formulas", () => {
		const cells: Record<string, string> = { A1: "=B1*2", A2: "", A3: "", B1: "1" };
		const down = fillRange(normalise({ row: 0, col: 0 }, { row: 2, col: 0 }), "down", (a) => cells[a] ?? "");
		expect(down).toEqual([{ a1: "A2", text: "=B2*2" }, { a1: "A3", text: "=B3*2" }]);
		const series = seriesRange(normalise({ row: 0, col: 1 }, { row: 3, col: 1 }), "down", (a) => ({ B1: "1", B2: "2" })[a] ?? "");
		expect(series.map((c) => c.text)).toEqual(["3", "4"]);
		expect(a1Of(0, 0)).toBe("A1");
	});
	it("gives conditional looks", () => {
		expect(cfLook(rule({ a: "10" }), "12", 12, st(0, 20))).toEqual({ fill: "#f00" });
		expect(cfLook(rule({ a: "10" }), "8", 8, st(0, 20))).toBeNull();
		expect(cfLook(rule({ kind: "contains", a: "ok" }), "Looks OK", undefined, st(0, 0))).toEqual({ fill: "#f00" });
		expect(cfLook(rule({ kind: "scale" }), "0", 0, st(0, 10))?.fill).toBe("#f8696b");
		expect(cfLook(rule({ kind: "scale" }), "10", 10, st(0, 10))?.fill).toBe("#63be7b");
		expect(cfLook(rule({ kind: "bar" }), "5", 5, st(0, 10))?.fill).toContain("50%");
		const cells = [{ text: "1", num: 1 }, { text: "5", num: 5 }, { text: "9", num: 9 }, { text: "5", num: 5 }];
		const stats = rangeStats(cells);
		expect(cfLook(rule({ kind: "top", a: "1" }), "9", 9, stats)).not.toBeNull();
		expect(cfLook(rule({ kind: "top", a: "1" }), "5", 5, stats)).toBeNull();
		expect(cfLook(rule({ kind: "bottom", a: "1" }), "1", 1, stats)).not.toBeNull();
		expect(cfLook(rule({ kind: "above" }), "9", 9, stats)).not.toBeNull();
		expect(cfLook(rule({ kind: "below" }), "1", 1, stats)).not.toBeNull();
		expect(cfLook(rule({ kind: "duplicate" }), "5", 5, stats)).not.toBeNull();
		expect(cfLook(rule({ kind: "duplicate" }), "1", 1, stats)).toBeNull();
		expect(cfLook(rule({ kind: "blank" }), "", undefined, stats)).not.toBeNull();
		expect(cfLook(rule({ kind: "icons", a: "3Arrows" }), "9", 9, stats)?.icon).toBe("▲");
		expect(cfLook(rule({ kind: "icons", a: "3Arrows" }), "5", 5, stats)?.icon).toBe("▶");
		expect(cfLook(rule({ kind: "icons", a: "3Arrows" }), "1", 1, stats)?.icon).toBe("▼");
		expect(cfLook(rule({ kind: "icons", a: "nonsense" }), "9", 9, stats)?.icon).toBe("▲");
	});
	it("validates entries", () => {
		const list: DvRule = { id: "d", sheet: "s", range: "A1", kind: "list", list: ["Yes", "No"], min: "", max: "" };
		expect(checkEntry(list, "yes")).toBeNull();
		expect(checkEntry(list, "Maybe")).toContain("Yes, No");
		const whole: DvRule = { ...list, kind: "whole", min: "1", max: "10" };
		expect(checkEntry(whole, "5")).toBeNull();
		expect(checkEntry(whole, "5.5")).not.toBeNull();
		expect(checkEntry(whole, "11")).not.toBeNull();
		expect(checkEntry(whole, "")).toBeNull();
		expect(inRange("B3", "A1:C5")).toBe(true);
		expect(inRange("D3", "A1:C5")).toBe(false);
	});
	it("splits, de-duplicates and pivots", () => {
		expect(splitText("a, b,c", ",")).toEqual(["a", "b", "c"]);
		expect(duplicateRows([["a", "1"], ["A", "2"], ["b", "1"]], [0])).toEqual([1]);
		const rows = [["Region", "Sales"], ["N", "10"], ["S", "5"], ["N", "7"]];
		expect(pivot(rows, 0, 1, "sum")).toEqual([["Region", "Sum of Sales"], ["N", "17"], ["S", "5"], ["Total", "22"]]);
		expect(pivot(rows, 0, 1, "count")[1]).toEqual(["N", "2"]);
		expect(pivot(rows, 0, 1, "average")[1]).toEqual(["N", "8.5"]);
	});
	it("seeks a goal", async () => {
		expect(await goalSeek(async (x) => x * 3 + 1, 10, 0, 100)).toBeCloseTo(3, 4);
		expect(await goalSeek(async (x) => x * x + 1, -5, 0, 10)).toBeNull();
	});
});
