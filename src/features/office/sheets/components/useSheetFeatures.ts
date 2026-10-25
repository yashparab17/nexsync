// What the Data and Home tabs do beyond typing: filling, hiding, filtering, protecting, conditional looks, validation, text to
// columns, removing duplicates, a pivot summary, goal seek and a snapshot of the workspace's tasks. State lives in the shared document
// (see `sheet.ts`); the arithmetic is in `sheetTools.ts`.

import { useCallback, useMemo } from "react";
import * as Y from "yjs";

import {
	a1Of,
	addSheet,
	cfOf,
	colLetters,
	dvOf,
	groupsOf,
	scenariosOf,
	sparksOf,
	hiddenIn,
	hiddenOf,
	lettersCol,
	parseA1,
	protectedOf,
	rangeText,
	readWorkbook,
	setCell,
	styleRange,
	type CellStyle,
	type Range,
	type SheetMeta,
	type Shown,
} from "@/features/office/sheets/lib/sheet";
import { extendRange, learnTransform, pivotAcross, TABLE_STYLES, tableLook } from "@/features/office/sheets/lib/sheetFill";
import { cfLook, rangeStats, type RangeStats, checkEntry, duplicateRows, fillRange, goalSeek, inRange, pivot, seriesRange, splitText, type CfRule, type DvRule, type PivotFn } from "@/features/office/sheets/lib/sheetTools";
import { getTasks, sheetCalculate } from "@/lib/tauri";

const LOCAL = "local-edit";

interface Options {
	doc: Y.Doc;
	sheet: SheetMeta | null;
	version: number;
	selection: Range;
	shown: Record<string, Shown>;
	typed: (a1: string) => string;
	look: (a1: string) => CellStyle;
	// The rows and columns the data fills, for tools that work on "the table"
	used: { rows: number; cols: number };
	workspacePath: string;
	flash: (ok: boolean, text: string) => void;
	setActiveId: (id: string) => void;
}

export function useSheetFeatures({ doc, sheet, version, selection, shown, typed, look, used, workspacePath, flash, setActiveId }: Options) {
	const edit = (fn: () => void) => doc.transact(fn, LOCAL);
	const id = sheet?.id ?? "";

	// ── state read from the document ──
	const hidden = useMemo(() => (sheet ? hiddenIn(doc, sheet.id) : { rows: new Set<number>(), cols: new Set<number>() }), [doc, sheet, version]); // eslint-disable-line react-hooks/exhaustive-deps
	const locked = sheet ? protectedOf(doc).get(sheet.id) === true : false;
	const cf = useMemo(() => (sheet ? cfOf(doc).toArray().filter((r) => r.sheet === sheet.id) : []), [doc, sheet, version]); // eslint-disable-line react-hooks/exhaustive-deps
	const dv = useMemo(() => (sheet ? dvOf(doc).toArray().filter((r) => r.sheet === sheet.id) : []), [doc, sheet, version]); // eslint-disable-line react-hooks/exhaustive-deps

	// The least and greatest number each rule's range holds, for colour scales and bars
	const spans = useMemo(() => {
		const out = new Map<string, RangeStats>();
		for (const r of cf) out.set(r.id, rangeStats(Object.entries(shown).filter(([a1]) => inRange(a1, r.range)).map(([, s]) => s)));
		return out;
	}, [cf, shown]);

	const sparks = useMemo(() => (sheet ? sparksOf(doc).toArray().filter((s) => s.sheet === sheet.id) : []), [doc, sheet, version]); // eslint-disable-line react-hooks/exhaustive-deps
	const addSpark = (source: string, cell: string, kind: "line" | "column" | "winloss", color: string) => sheet && edit(() => sparksOf(doc).push([{ id: Math.random().toString(36).slice(2, 10), sheet: id, cell, source, kind, color }]));
	const clearSparks = () =>
		sheet &&
		edit(() => {
			const list = sparksOf(doc);
			for (let i = list.length - 1; i >= 0; i--) if (list.get(i).sheet === id) list.delete(i, 1);
		});

	// How a cell looks: its own look, then what the conditional rules add
	const lookFor = useCallback(
		(a1: string): CellStyle => {
			const base = look(a1);
			const spark = sparks.find((s) => s.cell === a1);
			if (cf.length === 0 && !spark) return base;
			let out = base;
			if (spark) {
				const values: number[] = [];
				const [x, y] = spark.source.split(":");
				const s0 = parseA1(x);
				const s1 = parseA1(y ?? x);
				if (s0 && s1) for (let r = Math.min(s0.row, s1.row); r <= Math.max(s0.row, s1.row); r++) for (let c = Math.min(s0.col, s1.col); c <= Math.max(s0.col, s1.col); c++) values.push(shown[a1Of(r, c)]?.num ?? NaN);
				out = { ...out, spark: { values, kind: spark.kind, color: spark.color } };
			}
			for (const r of cf) {
				if (!inRange(a1, r.range)) continue;
				const add = cfLook(r, shown[a1]?.text ?? "", shown[a1]?.num, spans.get(r.id) ?? rangeStats([]));
				if (add) out = { ...out, ...add };
			}
			return out;
		},
		[look, cf, spans, shown, sparks],
	);

	const suggest = useCallback((a1: string) => dv.find((r) => r.kind === "list" && inRange(a1, r.range))?.list ?? null, [dv]);

	// The reason a typed entry is refused, or null
	const refusal = useCallback(
		(a1: string, text: string): string | null => {
			if (locked && !look(a1).unlocked) return "This sheet is protected. Unprotect it on the Data tab to change this cell.";
			for (const r of dv) if (inRange(a1, r.range)) {
				const why = checkEntry(r, text);
				if (why) return why;
			}
			return null;
		},
		[dv, locked, look],
	);
	// Whether the sheet's protection stops a change to a cell
	const blocked = useCallback((a1: string) => locked && !look(a1).unlocked, [locked, look]);

	// ── fill ──
	const put = (cells: { a1: string; text: string }[]) =>
		edit(() => {
			let skipped = 0;
			for (const c of cells) {
				if (blocked(c.a1)) skipped++;
				else setCell(doc, id, c.a1, c.text);
			}
			if (skipped) flash(false, `${skipped} cells are protected and were left as they were.`);
		});
	const fill = (dir: "down" | "right") => sheet && put(fillRange(selection, dir, typed));
	const series = (dir: "down" | "right") => sheet && put(seriesRange(selection, dir, typed));

	// ── hide, filter, protect ──
	const hide = (what: "rows" | "cols") =>
		sheet &&
		edit(() => {
			const map = hiddenOf(doc);
			if (what === "rows") for (let r = selection.r0; r <= selection.r1; r++) map.set(`${id}!r${r}`, "h");
			else for (let c = selection.c0; c <= selection.c1; c++) map.set(`${id}!c${c}`, "h");
		});
	const unhideAll = () =>
		sheet &&
		edit(() => {
			const map = hiddenOf(doc);
			for (const [k, v] of [...map]) if (k.startsWith(`${id}!`) && v === "h") map.delete(k);
		});
	// The rows the filter covers: below the first row of the data
	const dataRows = (): [number, number] => [1, Math.max(1, used.rows - 1)];
	const columnValues = (col: number): string[] => {
		const [a, b] = dataRows();
		const seen = new Set<string>();
		for (let r = a; r <= b; r++) seen.add(shown[a1Of(r, col)]?.text ?? "");
		return [...seen].sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }));
	};
	const applyFilter = (col: number, allowed: Set<string>) =>
		sheet &&
		edit(() => {
			const map = hiddenOf(doc);
			for (const [k, v] of [...map]) if (k.startsWith(`${id}!r`) && v === "f") map.delete(k);
			const [a, b] = dataRows();
			let n = 0;
			for (let r = a; r <= b; r++)
				if (!allowed.has(shown[a1Of(r, col)]?.text ?? "")) {
					map.set(`${id}!r${r}`, "f");
					n++;
				}
			flash(true, n === 0 ? "Every row matches." : `${n} rows are hidden by the filter. Clear Filter shows them again.`);
		});
	const clearFilter = () =>
		sheet &&
		edit(() => {
			const map = hiddenOf(doc);
			for (const [k, v] of [...map]) if (k.startsWith(`${id}!`) && v === "f") map.delete(k);
		});
	const filtered = [...hiddenOf(doc).entries()].some(([k, v]) => k.startsWith(`${id}!`) && v === "f");
	const protect = (on: boolean) => sheet && edit(() => (on ? protectedOf(doc).set(id, true) : protectedOf(doc).delete(id)));
	const unlock = (on: boolean) => sheet && styleRange(doc, id, selection, (c) => ({ ...c, unlocked: on }));

	// ── rules ──
	const newId = () => Math.random().toString(36).slice(2, 10);
	const addCf = (r: Omit<CfRule, "id" | "sheet" | "range">) => sheet && edit(() => cfOf(doc).push([{ ...r, id: newId(), sheet: id, range: rangeText(selection) }]));
	const addDv = (r: Omit<DvRule, "id" | "sheet" | "range">) => sheet && edit(() => dvOf(doc).push([{ ...r, id: newId(), sheet: id, range: rangeText(selection) }]));
	const clearRules = (which: "cf" | "dv") =>
		sheet &&
		edit(() => {
			const list = (which === "cf" ? cfOf(doc) : dvOf(doc)) as unknown as Y.Array<{ sheet: string; range: string }>;
			for (let i = list.length - 1; i >= 0; i--) if (list.get(i).sheet === id) list.delete(i, 1);
		});

	// ── data tools ──
	// The rows of the selection (or the whole table when one cell is chosen), as typed
	const grid = (display = false): { range: Range; rows: string[][] } => {
		const one = selection.r0 === selection.r1 && selection.c0 === selection.c1;
		const range: Range = one ? { r0: 0, c0: 0, r1: Math.max(0, used.rows - 1), c1: Math.max(0, used.cols - 1) } : selection;
		const rows: string[][] = [];
		for (let r = range.r0; r <= range.r1; r++) rows.push(Array.from({ length: range.c1 - range.c0 + 1 }, (_, i) => (display ? (shown[a1Of(r, range.c0 + i)]?.text ?? "") : typed(a1Of(r, range.c0 + i)))));
		return { range, rows };
	};
	const textToColumns = (delimiter: string) => {
		if (!sheet) return;
		const cells: { a1: string; text: string }[] = [];
		for (let r = selection.r0; r <= selection.r1; r++) splitText(typed(a1Of(r, selection.c0)), delimiter).forEach((text, i) => cells.push({ a1: a1Of(r, selection.c0 + i), text }));
		put(cells);
		flash(true, `Split ${selection.r1 - selection.r0 + 1} cells at "${delimiter}".`);
	};
	const removeDuplicates = () => {
		if (!sheet) return;
		const { range, rows } = grid();
		const [head, ...body] = rows;
		const drop = new Set(duplicateRows(body, body[0] ? body[0].map((_, i) => i) : []));
		if (drop.size === 0) return flash(true, "No duplicate rows.");
		const keep = body.filter((_, i) => !drop.has(i));
		const all = [head, ...keep];
		put(
			Array.from({ length: range.r1 - range.r0 + 1 }, (_, i) => i).flatMap((i) => Array.from({ length: range.c1 - range.c0 + 1 }, (_, j) => ({ a1: a1Of(range.r0 + i, range.c0 + j), text: all[i]?.[j] ?? "" }))),
		);
		flash(true, `${drop.size} duplicate rows removed; the rows below moved up.`);
	};
	// A summary of the table by one column, on a new sheet (a snapshot: it does not follow later changes)
	const makePivot = (by: number, of: number, fn: PivotFn, across = -1) => {
		if (!sheet) return;
		const { rows } = grid(true);
		const out = across >= 0 ? pivotAcross(rows, by, across, of, fn) : pivot(rows, by, of, fn);
		edit(() => {
			const meta = addSheet(doc);
			out.forEach((line, r) => line.forEach((text, c) => setCell(doc, meta.id, a1Of(r, c), text)));
			styleRange(doc, meta.id, { r0: 0, c0: 0, r1: 0, c1: 1 }, (c) => ({ ...c, bold: true }));
			setActiveId(meta.id);
		});
		flash(true, "The summary is on a new sheet. It is a snapshot; make it again after the data changes.");
	};
	const seek = async (setA1: string, target: number, changeA1: string) => {
		if (!sheet) return;
		const idx = readWorkbook(doc).findIndex((s) => s.name === sheet.name);
		const f = async (x: number) => {
			const book = readWorkbook(doc);
			book[idx].cells[changeA1] = String(x);
			const r = await sheetCalculate(book);
			return r.sheets[idx]?.cells[setA1]?.num ?? NaN;
		};
		const start = Number(typed(changeA1)) || 0;
		const span = Math.max(1000, Math.abs(start) * 100);
		const found = await goalSeek(f, target, start - span, start + span);
		if (found === null) return flash(false, "No input between the limits gives that result.");
		edit(() => setCell(doc, id, changeA1, String(Math.round(found * 1e6) / 1e6)));
		flash(true, `${changeA1} is now ${Math.round(found * 1e6) / 1e6}.`);
	};
	// The workspace's tasks written at the selected cell, a title row and a row for each (a snapshot)
	const insertTasks = async () => {
		if (!sheet) return;
		try {
			const tasks = await getTasks(workspacePath);
			const rows = [["Title", "Status", "Priority", "Due", "Assignee", "Tags"], ...tasks.map((t) => [t.title, t.status, t.priority, t.due_date ?? "", t.assignee_id ?? "", t.tags.join(", ")])];
			const at = { row: selection.r0, col: selection.c0 };
			put(rows.flatMap((line, i) => line.map((text, j) => ({ a1: a1Of(at.row + i, at.col + j), text }))));
			styleRange(doc, id, { r0: at.row, c0: at.col, r1: at.row, c1: at.col + 5 }, (c) => ({ ...c, bold: true }));
			flash(true, `${tasks.length} tasks placed at ${a1Of(at.row, at.col)}. It is a snapshot; insert again to refresh.`);
		} catch {
			flash(false, "The tasks could not be read.");
		}
	};

	// ── the fill handle, Flash Fill, tables ──
	const fillTo = (to: { row: number; col: number }) => sheet && put(extendRange(selection, to, typed));
	// The column of the caret filled from examples typed in it, using the column to its left as the source
	const flashFill = () => {
		if (!sheet) return;
		const col = selection.c0;
		if (col === 0) return flash(false, "Flash Fill needs a column of source text to the left.");
		const last = Math.max(used.rows, selection.r1 + 1);
		const pairs: [number, string, string][] = [];
		for (let r = 0; r < last; r++) pairs.push([r, shown[a1Of(r, col - 1)]?.text ?? "", typed(a1Of(r, col))]);
		const f = learnTransform(pairs.filter(([, a, b]) => a !== "" && b !== "").map(([, a, b]) => [a, b]));
		if (!f) return flash(false, "Type the result for one or two rows first; Flash Fill learns from them.");
		const empty = pairs.filter(([, a, b]) => a !== "" && b === "");
		put(empty.map(([r, a]) => ({ a1: a1Of(r, col), text: f(a) })));
		flash(true, `Filled ${empty.length} cells.`);
	};
	// The selection formatted as a table: a heading row in colour and every other row shaded
	const formatAsTable = (styleId: string) => {
		if (!sheet) return;
		const st = TABLE_STYLES.find((t) => t.id === styleId) ?? TABLE_STYLES[0];
		const { range } = grid();
		for (let r = range.r0; r <= range.r1; r++) styleRange(doc, id, { ...range, r0: r, r1: r }, (c) => ({ ...c, ...tableLook(r - range.r0, st, r === range.r1) }));
	};

	// ── groups: rows or columns that fold away ──
	const groups = useMemo(() => (sheet ? groupsOf(doc).toArray().filter((g) => g.sheet === sheet.id) : []), [doc, sheet, version]); // eslint-disable-line react-hooks/exhaustive-deps
	const group = (kind: "rows" | "cols") =>
		sheet &&
		edit(() => groupsOf(doc).push([{ id: newId(), sheet: id, kind, from: kind === "rows" ? selection.r0 : selection.c0, to: kind === "rows" ? selection.r1 : selection.c1 }]));
	const ungroup = () =>
		sheet &&
		edit(() => {
			const list = groupsOf(doc);
			for (let i = list.length - 1; i >= 0; i--) {
				const g = list.get(i);
				const hit = g.kind === "rows" ? selection.r1 >= g.from && selection.r0 <= g.to : selection.c1 >= g.from && selection.c0 <= g.to;
				if (g.sheet === id && hit) list.delete(i, 1);
			}
			const map = hiddenOf(doc);
			for (const [k, v] of [...map]) if (k.startsWith(`${id}!`) && v === "g") map.delete(k);
		});
	// The groups with whether each is folded now, for the plus and minus buttons in the headers; and one button's effect
	const groupMarks = groups.map((g) => ({ ...g, folded: hiddenOf(doc).get(`${id}!${g.kind === "rows" ? "r" : "c"}${g.from}`) === "g" }));
	const toggleGroup = (gid: string) =>
		sheet &&
		edit(() => {
			const g = groups.find((x) => x.id === gid);
			if (!g) return;
			const map = hiddenOf(doc);
			const key = (n: number) => `${id}!${g.kind === "rows" ? "r" : "c"}${n}`;
			const folded = map.get(key(g.from)) === "g";
			for (let n = g.from; n <= g.to; n++) {
				if (folded) map.get(key(n)) === "g" && map.delete(key(n));
				else map.set(key(n), "g");
			}
		});
	// Fold every group of the sheet away, or bring them all back
	const foldGroups = (fold: boolean) =>
		sheet &&
		edit(() => {
			const map = hiddenOf(doc);
			for (const g of groups) for (let n = g.from; n <= g.to; n++) (fold ? map.set(`${id}!${g.kind === "rows" ? "r" : "c"}${n}`, "g") : map.get(`${id}!${g.kind === "rows" ? "r" : "c"}${n}`) === "g" && map.delete(`${id}!${g.kind === "rows" ? "r" : "c"}${n}`));
		});

	// ── what-if: a table of results for a column of inputs, and named sets of values ──
	const dataTable = async (inputA1: string, formulaA1: string) => {
		if (!sheet) return;
		const idx = readWorkbook(doc).findIndex((s) => s.name === sheet.name);
		const inputs: number[] = [];
		for (let r = selection.r0; r <= Math.min(selection.r1, selection.r0 + 199); r++) inputs.push(r);
		const cells: { a1: string; text: string }[] = [];
		for (const r of inputs) {
			const book = readWorkbook(doc);
			book[idx].cells[inputA1] = typed(a1Of(r, selection.c0));
			const out = await sheetCalculate(book);
			cells.push({ a1: a1Of(r, selection.c0 + 1), text: String(out.sheets[idx]?.cells[formulaA1]?.num ?? out.sheets[idx]?.cells[formulaA1]?.text ?? "") });
		}
		put(cells);
		flash(true, `${cells.length} results written beside the inputs.`);
	};
	const scenarios = useMemo(() => (sheet ? scenariosOf(doc).toArray().filter((s) => s.sheet === sheet.id) : []), [doc, sheet, version]); // eslint-disable-line react-hooks/exhaustive-deps
	// Keeps what the selected cells hold now under a name
	const saveScenario = (name: string) => {
		if (!sheet) return;
		const cells: Record<string, string> = {};
		for (let r = selection.r0; r <= selection.r1; r++) for (let c = selection.c0; c <= selection.c1; c++) cells[a1Of(r, c)] = typed(a1Of(r, c));
		edit(() => scenariosOf(doc).push([{ id: newId(), sheet: id, name, cells }]));
	};
	const applyScenario = (sid: string) => {
		const sc = scenarios.find((s) => s.id === sid);
		if (sc) put(Object.entries(sc.cells).map(([a1, text]) => ({ a1, text })));
	};
	const deleteScenario = (sid: string) =>
		edit(() => {
			const list = scenariosOf(doc);
			const i = list.toArray().findIndex((s) => s.id === sid);
			if (i >= 0) list.delete(i, 1);
		});

	const columnNames = (): { col: number; letters: string; name: string }[] =>
		Array.from({ length: Math.max(1, used.cols) }, (_, c) => ({ col: c, letters: colLetters(c), name: shown[a1Of(0, c)]?.text || `Column ${colLetters(c)}` }));

	return {
		hidden,
		locked,
		cf,
		dv,
		filtered,
		lookFor,
		suggest,
		refusal,
		blocked,
		fill,
		series,
		hide,
		unhideAll,
		columnValues,
		applyFilter,
		clearFilter,
		protect,
		unlock,
		addCf,
		addDv,
		clearRules,
		textToColumns,
		removeDuplicates,
		makePivot,
		seek,
		insertTasks,
		fillTo,
		flashFill,
		formatAsTable,
		groups,
		groupMarks,
		toggleGroup,
		sparks,
		addSpark,
		clearSparks,
		group,
		ungroup,
		foldGroups,
		dataTable,
		scenarios,
		saveScenario,
		applyScenario,
		deleteScenario,
		columnNames,
		parseCell: (text: string) => {
			const p = parseA1(text.trim());
			return p ? a1Of(p.row, p.col) : null;
		},
		lettersCol,
	};
}
