// Spreadsheet operations that are plain data transformations (no engine, no document): filling a series, conditional looks, data
// validation, text to columns, a pivot summary, removing duplicate rows, and finding the input that makes a result.

import { a1Of, colLetters, lettersCol, parseA1, type CellStyle, type Range } from "@/features/office/sheets/lib/sheet";

// ── fill ──

// A formula with its relative references moved by some rows and columns, as copying it there would: $A$1 stays, A1 moves
export function shiftFormula(text: string, dRow: number, dCol: number): string {
	if (!text.startsWith("=")) return text;
	let inString = false;
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '"') inString = !inString;
		if (inString || ch === '"') {
			out += ch;
			continue;
		}
		const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(])/.exec(text.slice(i));
		const before = i > 0 ? text[i - 1] : "";
		if (m && !/[A-Za-z0-9_.]/.test(before)) {
			const col = m[1] ? lettersCol(m[2]) : lettersCol(m[2]) + dCol;
			const row = m[3] ? Number(m[4]) - 1 : Number(m[4]) - 1 + dRow;
			out += col < 0 || row < 0 ? "#REF!" : `${m[1]}${colLetters(col)}${m[3]}${row + 1}`;
			i += m[0].length - 1;
		} else out += ch;
	}
	return out;
}

const numeric = (t: string) => t.trim() !== "" && Number.isFinite(Number(t));

// The values that continue what `source` holds, `count` of them: numbers go on by their step (one number copies; two or more
// continue the line), text ending in a number counts up (Item 1, Item 2), and anything else repeats
export function continueSeries(source: string[], count: number): string[] {
	const out: string[] = [];
	if (source.length === 0) return Array(count).fill("");
	if (source.every(numeric)) {
		const nums = source.map(Number);
		const step = nums.length > 1 ? nums[1] - nums[0] : 0;
		const linear = nums.every((n, i) => i === 0 || Math.abs(n - nums[i - 1] - step) < 1e-9);
		for (let i = 1; i <= count; i++) out.push(String(linear ? Math.round((nums[nums.length - 1] + step * i) * 1e9) / 1e9 : nums[(i - 1) % nums.length]));
		return out;
	}
	const tail = /^(.*?)(\d+)$/.exec(source[source.length - 1]);
	if (source.length === 1 && tail && !source[0].startsWith("=")) {
		for (let i = 1; i <= count; i++) out.push(`${tail[1]}${String(Number(tail[2]) + i).padStart(tail[2].length, "0")}`);
		return out;
	}
	for (let i = 0; i < count; i++) out.push(source[i % source.length]);
	return out;
}

// What fills the cells below (or to the right of) the first `have` rows (or columns) of a range: the same series, continued
export function fillRange(range: Range, dir: "down" | "right", textAt: (a1: string) => string): { a1: string; text: string }[] {
	const out: { a1: string; text: string }[] = [];
	if (dir === "down") {
		for (let c = range.c0; c <= range.c1; c++) {
			const src = Array.from({ length: range.r1 - range.r0 + 1 }, (_, i) => textAt(a1Of(range.r0 + i, c)));
			// The first cell is the source; the rest of the selection is filled from it (Ctrl+D), or the series continues one more cell
			const seed = src.length === 1 ? src : src.slice(0, 1);
			const want = src.length === 1 ? 1 : src.length - 1;
			continueSeries(seed, want).forEach((text, i) => out.push({ a1: a1Of(range.r0 + 1 + i, c), text: seed[0].startsWith("=") ? shiftFormula(seed[0], i + 1, 0) : text }));
		}
	} else {
		for (let r = range.r0; r <= range.r1; r++) {
			const src = Array.from({ length: range.c1 - range.c0 + 1 }, (_, i) => textAt(a1Of(r, range.c0 + i)));
			const seed = src.slice(0, 1);
			const want = src.length === 1 ? 1 : src.length - 1;
			continueSeries(seed, want).forEach((text, i) => out.push({ a1: a1Of(r, range.c0 + 1 + i), text: seed[0].startsWith("=") ? shiftFormula(seed[0], 0, i + 1) : text }));
		}
	}
	return out;
}

// A series started in the first two cells, carried on to fill the whole range: 1, 2 then 3, 4, 5...
export function seriesRange(range: Range, dir: "down" | "right", textAt: (a1: string) => string): { a1: string; text: string }[] {
	const out: { a1: string; text: string }[] = [];
	const lines = dir === "down" ? range.c1 - range.c0 + 1 : range.r1 - range.r0 + 1;
	const len = dir === "down" ? range.r1 - range.r0 + 1 : range.c1 - range.c0 + 1;
	for (let l = 0; l < lines; l++) {
		const at = (i: number) => (dir === "down" ? a1Of(range.r0 + i, range.c0 + l) : a1Of(range.r0 + l, range.c0 + i));
		const seed = [textAt(at(0)), ...(len > 2 && textAt(at(1)) !== "" ? [textAt(at(1))] : [])];
		const done = seed.length;
		continueSeries(seed, len - done).forEach((text, i) => out.push({ a1: at(done + i), text }));
	}
	return out;
}

// ── conditional formatting ──

export interface CfRule {
	id: string;
	sheet: string;
	range: string;
	kind: "gt" | "lt" | "eq" | "between" | "contains" | "scale" | "bar" | "top" | "bottom" | "above" | "below" | "duplicate" | "blank" | "error" | "icons";
	a: string;
	b: string;
	color: string;
}

const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
const mix = (c1: [number, number, number], c2: [number, number, number], t: number) => `#${hex(c1[0] + (c2[0] - c1[0]) * t)}${hex(c1[1] + (c2[1] - c1[1]) * t)}${hex(c1[2] + (c2[2] - c1[2]) * t)}`;

// The icon sets a rule can use (named as Excel names them, so a saved file keeps them): an icon and a colour for the top, middle
// and bottom third
export const ICON_SETS: Record<string, { label: string; icons: [string, string, string]; colors: [string, string, string] }> = {
	"3Arrows": { label: "Arrows", icons: ["▲", "▶", "▼"], colors: ["#2E9D4F", "#E0A800", "#D13438"] },
	"3TrafficLights1": { label: "Traffic lights", icons: ["●", "●", "●"], colors: ["#2E9D4F", "#E0A800", "#D13438"] },
	"3Symbols": { label: "Symbols", icons: ["✔", "!", "✖"], colors: ["#2E9D4F", "#E0A800", "#D13438"] },
};

// What a rule needs to know about its whole range: the least, greatest and average number, the numbers from greatest down, and the
// texts that appear more than once
export interface RangeStats {
	lo: number;
	hi: number;
	avg: number;
	ranked: number[];
	dup: Set<string>;
}

export function rangeStats(cells: { text: string; num?: number }[]): RangeStats {
	const nums = cells.flatMap((c) => (c.num === undefined ? [] : [c.num]));
	const seen = new Map<string, number>();
	for (const c of cells) if (c.text !== "") seen.set(c.text.toLowerCase(), (seen.get(c.text.toLowerCase()) ?? 0) + 1);
	return { lo: nums.length ? Math.min(...nums) : 0, hi: nums.length ? Math.max(...nums) : 0, avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0, ranked: [...nums].sort((a, b) => b - a), dup: new Set([...seen].filter(([, n]) => n > 1).map(([t]) => t)) };
}

// The look a rule gives one cell, or null when the rule does not apply
export function cfLook(rule: CfRule, text: string, num: number | undefined, stats: RangeStats): CellStyle | null {
	const { lo, hi } = stats;
	switch (rule.kind) {
		case "top":
		case "bottom": {
			const n = Math.max(1, Number(rule.a) || 10);
			const edge = rule.kind === "top" ? stats.ranked[Math.min(n, stats.ranked.length) - 1] : [...stats.ranked].reverse()[Math.min(n, stats.ranked.length) - 1];
			return num !== undefined && edge !== undefined && (rule.kind === "top" ? num >= edge : num <= edge) ? { fill: rule.color } : null;
		}
		case "icons": {
			// Three icons by where the number falls between the least and the greatest: the top third, the middle third, the rest
			if (num === undefined || hi === lo) return null;
			const t = (num - lo) / (hi - lo);
			const k = t >= 2 / 3 ? 0 : t >= 1 / 3 ? 1 : 2;
			const set = ICON_SETS[rule.a] ?? ICON_SETS["3Arrows"];
			return { icon: set.icons[k], iconColor: set.colors[k] };
		}
		case "above":
			return num !== undefined && num > stats.avg ? { fill: rule.color } : null;
		case "below":
			return num !== undefined && num < stats.avg ? { fill: rule.color } : null;
		case "duplicate":
			return text !== "" && stats.dup.has(text.toLowerCase()) ? { fill: rule.color } : null;
		case "blank":
			return text === "" ? { fill: rule.color } : null;
		case "error":
			return text.startsWith("#") ? { fill: rule.color } : null;
		case "gt":
			return num !== undefined && num > Number(rule.a) ? { fill: rule.color } : null;
		case "lt":
			return num !== undefined && num < Number(rule.a) ? { fill: rule.color } : null;
		case "eq":
			return text === rule.a || (num !== undefined && num === Number(rule.a) && rule.a.trim() !== "") ? { fill: rule.color } : null;
		case "between":
			return num !== undefined && num >= Number(rule.a) && num <= Number(rule.b) ? { fill: rule.color } : null;
		case "contains":
			return rule.a !== "" && text.toLowerCase().includes(rule.a.toLowerCase()) ? { fill: rule.color } : null;
		case "scale":
			// Red (least) through yellow to green (greatest)
			if (num === undefined || hi === lo) return null;
			return { fill: ((t) => (t < 0.5 ? mix([248, 105, 107], [255, 235, 132], t * 2) : mix([255, 235, 132], [99, 190, 123], (t - 0.5) * 2)))((num - lo) / (hi - lo)) };
		case "bar":
			// A shaded bar as wide as the number is large, drawn as a hard-edged gradient
			if (num === undefined || hi === lo) return null;
			return { fill: `linear-gradient(to right, ${rule.color} ${Math.round(((num - Math.min(lo, 0)) / (hi - Math.min(lo, 0))) * 100)}%, transparent 0)` };
	}
}

// ── data validation ──

export interface DvRule {
	id: string;
	sheet: string;
	range: string;
	kind: "list" | "whole" | "decimal";
	list: string[];
	min: string;
	max: string;
}

// The reason an entry is refused, or null when the rule accepts it (an empty entry always is)
export function checkEntry(rule: DvRule, text: string): string | null {
	if (text === "" || text.startsWith("=")) return null;
	if (rule.kind === "list") return rule.list.some((v) => v.toLowerCase() === text.toLowerCase()) ? null : `Choose one of: ${rule.list.join(", ")}.`;
	const n = Number(text);
	const range = rule.min !== "" || rule.max !== "" ? ` between ${rule.min || "any"} and ${rule.max || "any"}` : "";
	if (!Number.isFinite(n) || (rule.kind === "whole" && !Number.isInteger(n))) return `Enter a ${rule.kind === "whole" ? "whole number" : "number"}${range}.`;
	if ((rule.min !== "" && n < Number(rule.min)) || (rule.max !== "" && n > Number(rule.max))) return `Enter a ${rule.kind === "whole" ? "whole number" : "number"}${range}.`;
	return null;
}

// Whether a cell is inside a range written as A1 or A1:B2
export function inRange(a1: string, range: string): boolean {
	const p = parseA1(a1);
	if (!p) return false;
	const [x, y] = range.split(":");
	const s = parseA1(x);
	const e = parseA1(y ?? x);
	return !!s && !!e && p.row >= Math.min(s.row, e.row) && p.row <= Math.max(s.row, e.row) && p.col >= Math.min(s.col, e.col) && p.col <= Math.max(s.col, e.col);
}

// ── text to columns, duplicates, pivot ──

export const splitText = (text: string, delimiter: string): string[] => (delimiter === "" ? [text] : text.split(delimiter).map((s) => s.trim()));

// Rows whose chosen columns repeat an earlier row's (case ignored); the first of each stays. Returns the row numbers to remove.
export function duplicateRows(rows: string[][], columns: number[]): number[] {
	const seen = new Set<string>();
	const drop: number[] = [];
	rows.forEach((r, i) => {
		const key = columns.map((c) => (r[c] ?? "").trim().toLowerCase()).join("\u0000");
		if (seen.has(key)) drop.push(i);
		else seen.add(key);
	});
	return drop;
}

export type PivotFn = "sum" | "count" | "average" | "max" | "min";

// A summary of the rows under a heading row: one line for each different value in the `by` column, with the function of the `of`
// column for the rows that share it. The groups are in the order they first appear.
export function pivot(rows: string[][], by: number, of: number, fn: PivotFn): string[][] {
	const [head, ...body] = rows;
	const groups = new Map<string, number[]>();
	for (const r of body) {
		const key = r[by] ?? "";
		const n = Number((r[of] ?? "").replace(/[,$%\s]/g, ""));
		const list = groups.get(key) ?? [];
		if (fn === "count" || (r[of] ?? "").trim() !== "") list.push(Number.isFinite(n) ? n : 0);
		groups.set(key, list);
	}
	const agg = (l: number[]) => {
		const v = fn === "count" ? l.length : fn === "sum" ? l.reduce((a, b) => a + b, 0) : fn === "average" ? (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0) : fn === "max" ? Math.max(...l) : Math.min(...l);
		return String(Math.round(v * 1e6) / 1e6);
	};
	const label = fn === "count" ? "Count" : fn[0].toUpperCase() + fn.slice(1);
	return [[head?.[by] ?? "", `${label} of ${head?.[of] ?? ""}`], ...[...groups].map(([k, l]) => [k, agg(l)]), ...(fn === "sum" || fn === "count" ? [["Total", agg([...groups.values()].flat())]] : [])];
}

// ── what-if ──

// The input that makes `f(input)` equal `target`, found by narrowing a range; null when the target is not between the ends. `f` is
// asked at most `tries` times (each is a calculation of the whole workbook).
export async function goalSeek(f: (x: number) => Promise<number>, target: number, lo: number, hi: number, tries = 40): Promise<number | null> {
	let a = lo;
	let b = hi;
	let fa = (await f(a)) - target;
	const fb = (await f(b)) - target;
	if (Number.isNaN(fa) || Number.isNaN(fb)) return null;
	if (Math.abs(fa) < 1e-9) return a;
	if (Math.abs(fb) < 1e-9) return b;
	if (Math.sign(fa) === Math.sign(fb)) return null;
	for (let i = 0; i < tries; i++) {
		const m = (a + b) / 2;
		const fm = (await f(m)) - target;
		if (Number.isNaN(fm)) return null;
		if (Math.abs(fm) < 1e-7) return m;
		if (Math.sign(fm) === Math.sign(fa)) {
			a = m;
			fa = fm;
		} else b = m;
	}
	return (a + b) / 2;
}
