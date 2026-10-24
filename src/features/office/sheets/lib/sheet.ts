// A spreadsheet as a shared document: the sheets, and what was typed into each cell. Nothing is calculated here; the answers come from
// the engine in the backend, from the same typed text, on every device.

import * as Y from "yjs";

// How one cell looks: colours are #RRGGBB, `borders` holds the sides drawn from "ltrb", `nf` is a number format code
export interface CellStyle {
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	wrap?: boolean;
	color?: string;
	fill?: string;
	align?: "left" | "center" | "right";
	nf?: string;
	size?: number;
	font?: string;
	borders?: string;
}

export interface SheetIn {
	name: string;
	// What was typed into each cell, by address
	cells: Record<string, string>;
	// How cells look, by address; only cells that differ from plain
	styles?: Record<string, CellStyle>;
	// Column widths in pixels, by column letters
	widths?: Record<string, number>;
	// Rows and columns frozen at the top and left
	freeze?: [number, number] | null;
	// Charts, for a file or a PDF that is being written
	charts?: { range: string; kind: string; title: string; at: string; w: number; h: number }[];
}

// A chart drawn over the grid: what it plots, what kind, and where it sits (a cell and a size in pixels)
export interface ChartSpec {
	id: string;
	sheet: string;
	range: string;
	kind: "column" | "bar" | "line" | "pie" | "doughnut" | "area" | "scatter";
	title: string;
	// Where its top-left corner is, in pixels from the top-left of the cells
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Shown {
	text: string;
	kind: "number" | "text" | "bool" | "error" | "empty";
	// The number a number cell holds, for the sum and average of a selection
	num?: number;
}

export interface SheetOut {
	name: string;
	cells: Record<string, Shown>;
}

export interface SheetMeta {
	id: string;
	name: string;
}

export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

// ── addresses ──

export function colLetters(col: number): string {
	let n = col + 1;
	let out = "";
	while (n > 0) {
		const r = (n - 1) % 26;
		out = String.fromCharCode(65 + r) + out;
		n = Math.floor((n - 1) / 26);
	}
	return out;
}

export function lettersCol(letters: string): number {
	let n = 0;
	for (const c of letters.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
	return n - 1;
}

export const a1Of = (row: number, col: number) => `${colLetters(col)}${row + 1}`;

export function parseA1(a1: string): { row: number; col: number } | null {
	const m = /^([A-Za-z]{1,3})(\d{1,7})$/.exec(a1);
	if (!m) return null;
	const col = lettersCol(m[1]);
	const row = Number(m[2]) - 1;
	return col < MAX_COLS && row >= 0 && row < MAX_ROWS ? { row, col } : null;
}

export interface Range {
	r0: number;
	c0: number;
	r1: number;
	c1: number;
}

export const normalise = (a: { row: number; col: number }, b: { row: number; col: number }): Range => ({ r0: Math.min(a.row, b.row), c0: Math.min(a.col, b.col), r1: Math.max(a.row, b.row), c1: Math.max(a.col, b.col) });

export const rangeText = (r: Range) => (r.r0 === r.r1 && r.c0 === r.c1 ? a1Of(r.r0, r.c0) : `${a1Of(r.r0, r.c0)}:${a1Of(r.r1, r.c1)}`);

// ── the shared document ──

const cellKey = (id: string, a1: string) => `${id}!${a1}`;

export const sheetsOf = (doc: Y.Doc) => doc.getArray<SheetMeta>("sheets");
export const cellsOf = (doc: Y.Doc) => doc.getMap<string>("cells");
// How cells look (each a small JSON text, so two people formatting different cells never collide), column widths and frozen panes
export const looksOf = (doc: Y.Doc) => doc.getMap<string>("looks");
export const widthsOf = (doc: Y.Doc) => doc.getMap<number>("widths");
export const frozenOf = (doc: Y.Doc) => doc.getMap<[number, number]>("frozen");
export const chartsOf = (doc: Y.Doc) => doc.getArray<ChartSpec>("charts");

export const MAX_STYLED_AT_ONCE = 50_000;

const clean = (s: CellStyle): CellStyle => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== false && v !== "")) as CellStyle;

export function lookOf(doc: Y.Doc, id: string, a1: string): CellStyle {
	const raw = looksOf(doc).get(cellKey(id, a1));
	if (!raw) return {};
	try {
		return JSON.parse(raw) as CellStyle;
	} catch {
		return {};
	}
}

// Changes how the cells of a range look: `change` gets each cell's current look and returns the new one. A range of more cells than
// MAX_STYLED_AT_ONCE is cut short, since each styled cell is kept and sent to everyone.
export function styleRange(doc: Y.Doc, id: string, r: Range, change: (cur: CellStyle) => CellStyle) {
	const looks = looksOf(doc);
	let n = 0;
	doc.transact(() => {
		for (let row = r.r0; row <= r.r1; row++)
			for (let col = r.c0; col <= r.c1; col++) {
				if (++n > MAX_STYLED_AT_ONCE) return;
				const key = cellKey(id, a1Of(row, col));
				const next = clean(change(lookOf(doc, id, a1Of(row, col))));
				if (Object.keys(next).length === 0) looks.delete(key);
				else looks.set(key, JSON.stringify(next));
			}
	}, "local-edit");
}

export function setWidth(doc: Y.Doc, id: string, col: number, px: number) {
	widthsOf(doc).set(`${id}!${colLetters(col)}`, Math.round(px));
}

export function widthsFor(doc: Y.Doc, id: string): Record<number, number> {
	const out: Record<number, number> = {};
	for (const [k, px] of widthsOf(doc)) if (k.startsWith(`${id}!`)) out[lettersCol(k.slice(id.length + 1))] = px;
	return out;
}

export const freezeOf = (doc: Y.Doc, id: string): [number, number] => frozenOf(doc).get(id) ?? [0, 0];
export function setFreeze(doc: Y.Doc, id: string, rows: number, cols: number) {
	if (rows === 0 && cols === 0) frozenOf(doc).delete(id);
	else frozenOf(doc).set(id, [rows, cols]);
}

export function listSheets(doc: Y.Doc): SheetMeta[] {
	return sheetsOf(doc).toArray();
}

export function typedText(doc: Y.Doc, id: string, a1: string): string {
	return cellsOf(doc).get(cellKey(id, a1)) ?? "";
}

// Types into a cell; empty text clears it
export function setCell(doc: Y.Doc, id: string, a1: string, text: string) {
	const cells = cellsOf(doc);
	if (text === "") cells.delete(cellKey(id, a1));
	else cells.set(cellKey(id, a1), text);
}

// The sheets as the engine wants them: names, and what is typed in each cell
export function readWorkbook(doc: Y.Doc): SheetIn[] {
	const sheets = listSheets(doc);
	const byId = new Map<string, SheetIn>(sheets.map((s) => [s.id, { name: s.name, cells: {} }]));
	for (const [key, text] of cellsOf(doc)) {
		const bang = key.indexOf("!");
		const sheet = byId.get(key.slice(0, bang));
		if (sheet) sheet.cells[key.slice(bang + 1)] = text;
	}
	// Looks, widths and frozen panes ride along only where there are some
	for (const [key, raw] of looksOf(doc)) {
		const bang = key.indexOf("!");
		const sheet = byId.get(key.slice(0, bang));
		if (!sheet) continue;
		try {
			(sheet.styles ??= {})[key.slice(bang + 1)] = JSON.parse(raw) as CellStyle;
		} catch {
			// A look nobody can read is left out
		}
	}
	for (const [key, px] of widthsOf(doc)) {
		const bang = key.indexOf("!");
		const sheet = byId.get(key.slice(0, bang));
		if (sheet) (sheet.widths ??= {})[key.slice(bang + 1)] = px;
	}
	for (const [id, f] of frozenOf(doc)) {
		const sheet = byId.get(id);
		if (sheet) sheet.freeze = f;
	}
	return sheets.map((s) => byId.get(s.id)!);
}

const newId = () => Math.random().toString(36).slice(2, 10);

// Fills an empty document from sheets read from a file; does nothing when the document already has sheets
export function seed(doc: Y.Doc, sheets: SheetIn[]): boolean {
	if (sheetsOf(doc).length > 0) return false;
	doc.transact(() => {
		const list = sheets.length > 0 ? sheets : [{ name: "Sheet1", cells: {} }];
		for (const s of list) {
			const id = newId();
			sheetsOf(doc).push([{ id, name: s.name }]);
			for (const [a1, text] of Object.entries(s.cells)) if (text !== "") cellsOf(doc).set(cellKey(id, a1), text);
			for (const [a1, look] of Object.entries(s.styles ?? {})) if (Object.keys(clean(look)).length > 0) looksOf(doc).set(cellKey(id, a1), JSON.stringify(clean(look)));
			for (const [letters, px] of Object.entries(s.widths ?? {})) widthsOf(doc).set(`${id}!${letters}`, px);
			if (s.freeze && (s.freeze[0] > 0 || s.freeze[1] > 0)) frozenOf(doc).set(id, s.freeze);
		}
	});
	return true;
}

// Makes the document match sheets the engine rewrote (after rows or columns were inserted or removed); keeps the ids
export function replaceWorkbook(doc: Y.Doc, sheets: SheetIn[]) {
	doc.transact(() => {
		const metas = listSheets(doc);
		const cells = cellsOf(doc);
		const want = new Map<string, string>();
		sheets.forEach((s, i) => {
			const meta = metas[i];
			if (meta) for (const [a1, text] of Object.entries(s.cells)) want.set(cellKey(meta.id, a1), text);
		});
		for (const key of [...cells.keys()]) if (!want.has(key)) cells.delete(key);
		for (const [key, text] of want) if (cells.get(key) !== text) cells.set(key, text);
		// The engine moves looks with the cells it moves
		const looks = looksOf(doc);
		const wantLooks = new Map<string, string>();
		sheets.forEach((s, i) => {
			const meta = metas[i];
			if (meta) for (const [a1, look] of Object.entries(s.styles ?? {})) wantLooks.set(cellKey(meta.id, a1), JSON.stringify(clean(look)));
		});
		for (const key of [...looks.keys()]) if (!wantLooks.has(key)) looks.delete(key);
		for (const [key, text] of wantLooks) if (looks.get(key) !== text) looks.set(key, text);
	});
}

export function addSheet(doc: Y.Doc): SheetMeta {
	const names = new Set(listSheets(doc).map((s) => s.name.toLowerCase()));
	let n = listSheets(doc).length + 1;
	while (names.has(`sheet${n}`)) n++;
	const meta = { id: newId(), name: `Sheet${n}` };
	sheetsOf(doc).push([meta]);
	return meta;
}

// Renames a sheet. Formulas that name it by its old name are not rewritten (the engine does that on a rename only inside one
// session), so the caller says so.
export function renameSheet(doc: Y.Doc, id: string, name: string): string | null {
	const clean = name.trim();
	if (!clean || clean.length > 31 || /[\\/?*[\]:]/.test(clean)) return "A sheet name has 1 to 31 characters and none of \\ / ? * [ ] :";
	const sheets = listSheets(doc);
	if (sheets.some((s) => s.id !== id && s.name.toLowerCase() === clean.toLowerCase())) return "Another sheet has that name.";
	const i = sheets.findIndex((s) => s.id === id);
	if (i < 0) return "That sheet is gone.";
	doc.transact(() => {
		sheetsOf(doc).delete(i, 1);
		sheetsOf(doc).insert(i, [{ id, name: clean }]);
	});
	return null;
}

export function deleteSheet(doc: Y.Doc, id: string): string | null {
	const sheets = listSheets(doc);
	if (sheets.length <= 1) return "A workbook keeps at least one sheet.";
	const i = sheets.findIndex((s) => s.id === id);
	if (i < 0) return null;
	doc.transact(() => {
		sheetsOf(doc).delete(i, 1);
		const cells = cellsOf(doc);
		for (const key of [...cells.keys()]) if (key.startsWith(`${id}!`)) cells.delete(key);
		for (const m of [looksOf(doc), widthsOf(doc)] as Y.Map<unknown>[]) for (const key of [...m.keys()]) if (key.startsWith(`${id}!`)) m.delete(key);
		frozenOf(doc).delete(id);
		const charts = chartsOf(doc);
		for (let j = charts.length - 1; j >= 0; j--) if (charts.get(j).sheet === id) charts.delete(j, 1);
	});
	return null;
}

// The workbook for a file or a PDF: the same, with the charts, each anchored at the cell it sits over
export function readWorkbookForFile(doc: Y.Doc, colWidth = 96, rowHeight = 24): SheetIn[] {
	const book = readWorkbook(doc);
	const metas = listSheets(doc);
	for (const c of chartsOf(doc).toArray()) {
		const i = metas.findIndex((m) => m.id === c.sheet);
		if (i >= 0) (book[i].charts ??= []).push({ range: c.range, kind: c.kind, title: c.title, at: a1Of(Math.max(0, Math.floor(c.y / rowHeight)), Math.max(0, Math.floor(c.x / colWidth))), w: c.w, h: c.h });
	}
	return book;
}

// ── the clipboard ──

export const toTsv = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\n");

// Tab-separated text (what spreadsheets put on the clipboard), with quoted cells that may hold tabs and line breaks
export function parseTsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cur = "";
	let quoted = false;
	const t = text.replace(/\r\n?/g, "\n");
	for (let i = 0; i < t.length; i++) {
		const c = t[i];
		if (quoted) {
			if (c === '"' && t[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (c === '"') quoted = false;
			else cur += c;
		} else if (c === '"' && cur === "") quoted = true;
		else if (c === "\t") {
			row.push(cur);
			cur = "";
		} else if (c === "\n") {
			row.push(cur);
			rows.push(row);
			row = [];
			cur = "";
		} else cur += c;
	}
	if (cur !== "" || row.length > 0) {
		row.push(cur);
		rows.push(row);
	}
	return rows;
}

// Where the used cells of a sheet end, for sizing the grid
export function extent(cells: Record<string, unknown>): { rows: number; cols: number } {
	let rows = 0;
	let cols = 0;
	for (const a1 of Object.keys(cells)) {
		const p = parseA1(a1);
		if (p) {
			rows = Math.max(rows, p.row + 1);
			cols = Math.max(cols, p.col + 1);
		}
	}
	return { rows, cols };
}

// ── charts: what the engine draws, as shapes and text ──

type Rgba = [number, number, number, number];
type Stroke = [Rgba, number] | null;
export type ChartPrim =
	| { Rect: { x: number; y: number; w: number; h: number; fill: Rgba | null; stroke: Stroke; radius: number } }
	| { Line: { pts: [number, number][]; color: Rgba; width: number; dash: boolean } }
	| { Polygon: { pts: [number, number][]; fill: Rgba; stroke: Stroke } }
	| { Wedge: { cx: number; cy: number; r_outer: number; r_inner: number; a0: number; a1: number; fill: Rgba; stroke: Stroke } }
	| { Circle: { cx: number; cy: number; r: number; fill: Rgba | null; stroke: Stroke } }
	| { Text: { x: number; y: number; text: string; size: number; color: Rgba; bold: boolean; align: "Left" | "Center" | "Right"; valign: "Top" | "Middle" | "Bottom"; rotation: number } };

// ── number formats offered in the ribbon ──

export const NUMBER_FORMATS: { id: string; label: string; code: string; sample: string }[] = [
	{ id: "general", label: "General", code: "", sample: "1234.5" },
	{ id: "number", label: "Number", code: "0.00", sample: "1234.50" },
	{ id: "currency", label: "Currency", code: '"$"#,##0.00', sample: "$1,234.50" },
	{ id: "accounting", label: "Accounting", code: '_("$"* #,##0.00_);_("$"* \(#,##0.00\);_("$"* "-"??_);_(@_)', sample: "$ 1,234.50" },
	{ id: "date", label: "Short Date", code: "m/d/yyyy", sample: "1/1/2025" },
	{ id: "time", label: "Time", code: "h:mm:ss AM/PM", sample: "1:30:00 PM" },
	{ id: "percent", label: "Percentage", code: "0.00%", sample: "12.00%" },
	{ id: "fraction", label: "Fraction", code: "# ?/?", sample: "1 1/2" },
	{ id: "scientific", label: "Scientific", code: "0.00E+00", sample: "1.23E+03" },
	{ id: "text", label: "Text", code: "@", sample: "abc" },
];

// One more or one fewer decimal place on a number format code (the Increase and Decrease Decimal buttons)
export function stepDecimals(code: string | undefined, by: 1 | -1): string {
	const c = code && code !== "General" ? code : "0";
	const m = /0(?:\.(0*))?(?!.*0)/.exec(c);
	if (!m) return c;
	const have = m[1]?.length ?? 0;
	const want = Math.max(0, Math.min(15, have + by));
	if (want === have) return c;
	const at = m.index + 1 + (m[1] !== undefined ? 1 + have : 0);
	const head = c.slice(0, m.index + 1);
	return head + (want > 0 ? "." + "0".repeat(want) : "") + c.slice(at);
}

// ── paste special, duplicates and JSON ──

// Rows turned into columns
export const transpose = (rows: string[][]): string[][] => Array.from({ length: Math.max(0, ...rows.map((r) => r.length)) }, (_, c) => rows.map((r) => r[c] ?? ""));

// The addresses in a range whose text also appears in another cell of it (empty cells and case are ignored)
export function duplicateAddresses(r: Range, textAt: (a1: string) => string): string[] {
	const seen = new Map<string, string[]>();
	for (let row = r.r0; row <= r.r1; row++)
		for (let col = r.c0; col <= r.c1; col++) {
			const a1 = a1Of(row, col);
			const t = textAt(a1).trim().toLowerCase();
			if (t) seen.set(t, [...(seen.get(t) ?? []), a1]);
		}
	return [...seen.values()].filter((l) => l.length > 1).flat();
}

// A JSON array as rows: objects become a heading row of their keys (in the order first seen) and one row each; arrays of arrays
// are taken as they are. Nested values are written as JSON text. null when it is not an array of rows.
export function jsonToRows(text: string): string[][] | null {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return null;
	}
	if (!Array.isArray(data) || data.length === 0) return null;
	const show = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
	if (data.every(Array.isArray)) return (data as unknown[][]).map((r) => r.map(show));
	if (!data.every((d) => d && typeof d === "object" && !Array.isArray(d))) return null;
	const keys = [...new Set(data.flatMap((d) => Object.keys(d as object)))];
	return [keys, ...data.map((d) => keys.map((k) => show((d as Record<string, unknown>)[k])))];
}
