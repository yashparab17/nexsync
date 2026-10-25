// Spreadsheet operations that are plain data transformations, part two (see sheetTools.ts): dragging the fill handle, Flash Fill, a
// summary across two columns, and the look of a range formatted as a table.

import { a1Of, type CellStyle, type Range } from "@/features/office/sheets/lib/sheet";
import { continueSeries, shiftFormula, type PivotFn } from "@/features/office/sheets/lib/sheetTools";

// ── drag fill ──

// What the cells between a selection and the cell the fill handle was dragged to hold: the selection's series carried on down or
// to the right (whichever way was dragged further). A formula moves its references; a block of several formulas moves by the block.
export function extendRange(sel: Range, to: { row: number; col: number }, textAt: (a1: string) => string): { a1: string; text: string }[] {
	const down = to.row - sel.r1;
	const right = to.col - sel.c1;
	if (down <= 0 && right <= 0) return [];
	const vertical = down >= right;
	const out: { a1: string; text: string }[] = [];
	const lines = vertical ? sel.c1 - sel.c0 + 1 : sel.r1 - sel.r0 + 1;
	const len = vertical ? sel.r1 - sel.r0 + 1 : sel.c1 - sel.c0 + 1;
	const count = vertical ? down : right;
	for (let l = 0; l < lines; l++) {
		const at = (i: number) => (vertical ? a1Of(sel.r0 + i, sel.c0 + l) : a1Of(sel.r0 + l, sel.c0 + i));
		const src = Array.from({ length: len }, (_, i) => textAt(at(i)));
		const series = continueSeries(src, count);
		for (let i = 0; i < count; i++) {
			const from = src[i % len];
			const blocks = Math.floor(i / len) + 1;
			const text = from.startsWith("=") ? shiftFormula(from, vertical ? blocks * len : 0, vertical ? 0 : blocks * len) : series[i];
			out.push({ a1: at(len + i), text });
		}
	}
	return out;
}

// ── flash fill ──

const words = (t: string) => t.split(/[\s,;]+/).filter(Boolean);
const proper = (t: string) => t.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
const TRANSFORMS: ((t: string) => string)[] = [
	(t) => words(t)[0] ?? "",
	(t) => words(t)[words(t).length - 1] ?? "",
	(t) => words(t).map((w) => w[0].toUpperCase()).join(""),
	(t) => words(t).map((w) => `${w[0].toUpperCase()}.`).join(""),
	(t) => t.toUpperCase(),
	(t) => t.toLowerCase(),
	proper,
	(t) => t.replace(/\D/g, ""),
	(t) => t.replace(/[^A-Za-z]/g, ""),
	(t) => {
		const w = words(t);
		return w.length > 1 ? `${w[w.length - 1]}, ${w.slice(0, -1).join(" ")}` : t;
	},
	(t) => t.split("@")[0],
	(t) => t.split("@")[1] ?? "",
	(t) => t.split("-")[0].trim(),
	(t) => t.split("-").slice(1).join("-").trim(),
	(t) => t.split("/")[0].trim(),
	(t) => t.split("/").slice(1).join("/").trim(),
	(t) => t.split(".")[0],
	(t) => /[(\[]([^)\]]*)[)\]]/.exec(t)?.[1] ?? "",
];

// The way to turn the first text into the second, from examples: a transform from the list above, a fixed start or end added to the
// text, or its first or last few characters. null when nothing fits every example.
export function learnTransform(examples: [string, string][]): ((t: string) => string) | null {
	const ex = examples.filter(([a, b]) => a !== "" && b !== "");
	if (ex.length === 0) return null;
	for (const f of TRANSFORMS) if (ex.every(([a, b]) => f(a) === b)) return f;
	const [a0, b0] = ex[0];
	const i = b0.indexOf(a0);
	if (i >= 0) {
		const pre = b0.slice(0, i);
		const post = b0.slice(i + a0.length);
		if (ex.every(([a, b]) => b === pre + a + post)) return (t) => pre + t + post;
	}
	for (let n = 1; n <= 12; n++) {
		if (ex.every(([a, b]) => a.slice(0, n) === b)) return (t) => t.slice(0, n);
		if (ex.every(([a, b]) => a.slice(-n) === b)) return (t) => t.slice(-n);
	}
	return null;
}

// ── a summary across two columns ──

// Rows grouped by one column and, across the top, by another, each cell the function of the third column for the rows that share both
export function pivotAcross(rows: string[][], by: number, across: number, of: number, fn: PivotFn): string[][] {
	const [head, ...body] = rows;
	const rowKeys = [...new Set(body.map((r) => r[by] ?? ""))];
	const colKeys = [...new Set(body.map((r) => r[across] ?? ""))];
	const totals = fn === "sum" || fn === "count";
	const cell = (rk: string | null, ck: string | null) => {
		const nums = body.filter((r) => (rk === null || (r[by] ?? "") === rk) && (ck === null || (r[across] ?? "") === ck)).map((r) => Number((r[of] ?? "").replace(/[,$%\s]/g, "")));
		const ok = nums.filter((n) => Number.isFinite(n));
		if (fn === "count") return String(nums.length);
		if (ok.length === 0) return "";
		const v = fn === "sum" ? ok.reduce((a, b) => a + b, 0) : fn === "average" ? ok.reduce((a, b) => a + b, 0) / ok.length : fn === "max" ? Math.max(...ok) : Math.min(...ok);
		return String(Math.round(v * 1e6) / 1e6);
	};
	const label = fn === "count" ? "Count" : fn[0].toUpperCase() + fn.slice(1);
	return [
		[`${label} of ${head?.[of] ?? ""}`, ...colKeys, ...(totals ? ["Total"] : [])],
		...rowKeys.map((rk) => [rk, ...colKeys.map((ck) => cell(rk, ck)), ...(totals ? [cell(rk, null)] : [])]),
		...(totals ? [["Total", ...colKeys.map((ck) => cell(null, ck)), cell(null, null)]] : []),
	];
}

// ── format as a table ──

export const TABLE_STYLES: { id: string; label: string; head: string; band: string }[] = [
	{ id: "green", label: "Green", head: "#217346", band: "#E2EFDA" },
	{ id: "blue", label: "Blue", head: "#2F5597", band: "#DAE3F3" },
	{ id: "grey", label: "Grey", head: "#595959", band: "#EDEDED" },
	{ id: "orange", label: "Orange", head: "#C55A11", band: "#FBE5D6" },
];

// The look of the cells of row `i` (0 is the heading) of a range formatted as a table
export function tableLook(i: number, style: (typeof TABLE_STYLES)[number], lastRow: boolean): CellStyle {
	if (i === 0) return { bold: true, fill: style.head, color: "#FFFFFF" };
	return { ...(i % 2 === 0 ? { fill: style.band } : {}), ...(lastRow ? { borders: "b" } : {}) };
}
