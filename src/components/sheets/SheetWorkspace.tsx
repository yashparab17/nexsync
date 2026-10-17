// A workbook open for editing: the title bar, tabs and ribbon of a spreadsheet program around the grid. What people type and how cells look
// live in the shared document; the answers come from the engine, from that same text, on every device.

import { save } from "@tauri-apps/plugin-dialog";
import { Download, FilePenLine, Info, Redo2, Save, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

import Backstage from "@/components/office/Backstage";
import { PeopleStack, usePeople } from "@/components/office/People";
import { OfficeFrame, type RibbonTab } from "@/components/office/Ribbon";
import ChartView from "@/components/sheets/ChartView";
import SheetGrid, { COL_W, type Cursor, type Other } from "@/components/sheets/SheetGrid";
import SheetRibbon from "@/components/sheets/SheetRibbon";
import Loading from "@/components/Loading";
import { Button } from "@/components/ui/button";
import type { CollabDoc } from "@/hooks/useCollabDoc";
import { colorOf } from "@/lib/collabColor";
import {
	a1Of,
	addSheet,
	cellsOf,
	chartsOf,
	colLetters,
	deleteSheet,
	extent,
	freezeOf,
	frozenOf,
	listSheets,
	looksOf,
	lookOf,
	rangeText,
	readWorkbook,
	readWorkbookForFile,
	renameSheet,
	replaceWorkbook,
	seed,
	setCell,
	setFreeze,
	setWidth,
	sheetsOf,
	styleRange,
	typedText,
	widthsFor,
	widthsOf,
	type CellStyle,
	type ChartSpec,
	type Range,
	type SheetIn,
	type SheetMeta,
	type SheetOut,
} from "@/lib/sheet";
import { sheetCalculate, sheetRestructure, sheetSave, sheetSort } from "@/lib/tauri";
import { cn, errorText } from "@/lib/utils";

const LOCAL = "local-edit";
const TABS: RibbonTab[] = [
	{ id: "home", label: "Home" },
	{ id: "insert", label: "Insert" },
	{ id: "formulas", label: "Formulas" },
	{ id: "data", label: "Data" },
	{ id: "view", label: "View" },
];
const FORMATS = [
	{ ext: "xlsx", label: "Excel Workbook (.xlsx)" },
	{ ext: "csv", label: "This sheet as CSV (.csv)" },
	{ ext: "tsv", label: "This sheet as tab-separated (.tsv)" },
	{ ext: "pdf", label: "This sheet as PDF (.pdf)" },
];

export interface SheetWorkspaceProps {
	collab: CollabDoc;
	opened: { sheets: SheetIn[]; notes: string[] };
	name: string;
	// The file's place in the workspace, such as files/budget.xlsx
	rel: string;
	workspacePath: string;
	author: string;
	readOnly: boolean;
}

export default function SheetWorkspace({ collab, opened, name, rel, workspacePath, author, readOnly }: SheetWorkspaceProps) {
	const { doc } = collab;
	const [tab, setTab] = useState("home");
	const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
	const flash = (ok: boolean, text: string) => setNotice({ ok, text });
	const people = usePeople(collab.awareness, "cell");

	// What is in the shared document, as a number that moves when anyone changes anything
	const [version, setVersion] = useState(0);
	useEffect(() => {
		const bump = () => setVersion((v) => v + 1);
		doc.on("update", bump);
		return () => doc.off("update", bump);
	}, [doc]);

	// (After the listener above, so the first fill is seen.) The first device to open the file fills the shared workbook from it
	useEffect(() => {
		if (collab.synced) seed(doc, opened.sheets);
	}, [collab.synced, doc, opened]);

	const sheets: SheetMeta[] = useMemo(() => listSheets(doc), [doc, version]); // eslint-disable-line react-hooks/exhaustive-deps
	const [activeId, setActiveId] = useState<string | null>(null);
	const sheet = sheets.find((s) => s.id === activeId) ?? sheets[0] ?? null;

	// The engine's answers, asked again shortly after the last change
	const [calc, setCalc] = useState<SheetOut[]>([]);
	const asked = useRef(0);
	useEffect(() => {
		if (sheets.length === 0) return;
		const n = ++asked.current;
		const timer = setTimeout(() => {
			sheetCalculate(readWorkbook(doc))
				.then((r) => {
					if (n !== asked.current) return;
					setCalc(r.sheets);
					setNotice((cur) => (r.truncated ? { ok: false, text: "A formula made so many cells that only the first 300,000 are shown." } : cur && !cur.ok && cur.text.startsWith("A formula made") ? null : cur));
				})
				.catch((err) => {
					if (n !== asked.current) return;
					const text = errorText(err, "The sheet could not be calculated.");
					// The last calculation is still running: try again shortly
					if (text.startsWith("Still working")) setTimeout(() => n === asked.current && setVersion((v) => v + 1), 1500);
					else setNotice({ ok: false, text });
				});
		}, 120);
		return () => clearTimeout(timer);
	}, [doc, version, sheets.length]);
	const shown = useMemo(() => calc.find((c) => c.name === sheet?.name)?.cells ?? {}, [calc, sheet?.name]);

	const typed = useCallback((a1: string) => (sheet ? typedText(doc, sheet.id, a1) : ""), [doc, sheet, version]); // eslint-disable-line react-hooks/exhaustive-deps
	const look = useCallback((a1: string) => (sheet ? lookOf(doc, sheet.id, a1) : {}), [doc, sheet, version]); // eslint-disable-line react-hooks/exhaustive-deps
	const widths = useMemo(() => (sheet ? widthsFor(doc, sheet.id) : {}), [doc, sheet, version]); // eslint-disable-line react-hooks/exhaustive-deps
	const freeze = useMemo(() => (sheet ? freezeOf(doc, sheet.id) : ([0, 0] as [number, number])), [doc, sheet, version]); // eslint-disable-line react-hooks/exhaustive-deps
	const used = useMemo(() => extent(sheet ? Object.fromEntries([...cellsOf(doc).keys(), ...looksOf(doc).keys()].filter((k) => k.startsWith(`${sheet.id}!`)).map((k) => [k.slice(k.indexOf("!") + 1), 1])) : {}), [doc, sheet, version]); // eslint-disable-line react-hooks/exhaustive-deps

	const undo = useMemo(() => new Y.UndoManager([cellsOf(doc), sheetsOf(doc), looksOf(doc), widthsOf(doc), frozenOf(doc), chartsOf(doc)], { trackedOrigins: new Set([LOCAL]) }), [doc]);

	const [active, setActive] = useState<Cursor>({ row: 0, col: 0 });
	const [selection, setSelection] = useState<Range>({ r0: 0, c0: 0, r1: 0, c1: 0 });
	const [bar, setBar] = useState<string | null>(null);
	const barInput = useRef<HTMLInputElement>(null);
	const [view, setView] = useState({ grid: true, formulaBar: true });
	const activeA1 = a1Of(active.row, active.col);
	const activeLook = look(activeA1);
	const single = selection.r0 === selection.r1 && selection.c0 === selection.c1;

	// Who else is where, on this sheet
	const [others, setOthers] = useState<Other[]>([]);
	useEffect(() => {
		if (!sheet) return;
		const aw = collab.awareness;
		aw.setLocalStateField("cell", { sheet: sheet.id, row: active.row, col: active.col, name: author, color: colorOf(author) });
		const read = () => {
			const out: Other[] = [];
			aw.getStates().forEach((st, client) => {
				const c = st.cell as { sheet: string; row: number; col: number; name: string; color: string } | undefined;
				if (client !== aw.clientID && c && c.sheet === sheet.id) out.push({ name: c.name, color: c.color, row: c.row, col: c.col });
			});
			setOthers(out);
		};
		aw.on("change", read);
		read();
		return () => aw.off("change", read);
	}, [collab, sheet, active.row, active.col, author]);

	const edit = (fn: () => void) => doc.transact(fn, LOCAL);
	const onCommit = (a1: string, text: string) => sheet && edit(() => setCell(doc, sheet.id, a1, text));
	const onClear = (r: Range) =>
		sheet &&
		edit(() => {
			for (let row = r.r0; row <= r.r1; row++) for (let col = r.c0; col <= r.c1; col++) setCell(doc, sheet.id, a1Of(row, col), "");
		});
	const onPaste = (at: Cursor, rows: string[][]) =>
		sheet &&
		edit(() => {
			rows.forEach((line, i) => line.forEach((text, j) => setCell(doc, sheet.id, a1Of(at.row + i, at.col + j), text)));
		});
	const style = (change: (cur: CellStyle) => CellStyle) => sheet && styleRange(doc, sheet.id, selection, change);

	const restructure = async (op: "insertRows" | "deleteRows" | "insertCols" | "deleteCols") => {
		if (!sheet) return;
		const rowsOp = op.endsWith("Rows");
		const count = rowsOp ? selection.r1 - selection.r0 + 1 : selection.c1 - selection.c0 + 1;
		try {
			const next = await sheetRestructure(readWorkbook(doc), sheet.name, op, rowsOp ? selection.r0 : selection.c0, count);
			edit(() => replaceWorkbook(doc, next));
		} catch (err) {
			flash(false, errorText(err, "That did not work."));
		}
	};

	// The rows of the selection, or of the whole used area when one cell is chosen
	const dataRange = (): Range => (single ? { r0: 0, c0: 0, r1: Math.max(0, used.rows - 1), c1: Math.max(0, used.cols - 1) } : selection);

	const sort = async (descending: boolean) => {
		if (!sheet) return;
		const r = dataRange();
		const col = Math.min(Math.max(active.col, r.c0), r.c1);
		const isNum = (a1: string) => shown[a1]?.kind === "number";
		const header = r.r1 > r.r0 && [...Array(r.c1 - r.c0 + 1).keys()].every((i) => !isNum(a1Of(r.r0, r.c0 + i))) && [...Array(r.c1 - r.c0 + 1).keys()].some((i) => isNum(a1Of(r.r0 + 1, r.c0 + i)));
		try {
			const next = await sheetSort(readWorkbook(doc), sheet.name, rangeText(r), colLetters(col), descending, header);
			edit(() => replaceWorkbook(doc, next));
		} catch (err) {
			flash(false, errorText(err, "That could not be sorted."));
		}
	};

	const autoSum = (fn: "SUM" | "AVERAGE" | "COUNT" | "MAX" | "MIN") => {
		if (!sheet) return;
		const isNum = (row: number, col: number) => shown[a1Of(row, col)]?.kind === "number";
		edit(() => {
			if (!single) {
				for (let c = selection.c0; c <= selection.c1; c++) setCell(doc, sheet.id, a1Of(selection.r1 + 1, c), `=${fn}(${a1Of(selection.r0, c)}:${a1Of(selection.r1, c)})`);
				return;
			}
			let top = active.row;
			while (top > 0 && isNum(top - 1, active.col)) top--;
			if (top < active.row) return setCell(doc, sheet.id, activeA1, `=${fn}(${a1Of(top, active.col)}:${a1Of(active.row - 1, active.col)})`);
			let left = active.col;
			while (left > 0 && isNum(active.row, left - 1)) left--;
			setCell(doc, sheet.id, activeA1, `=${fn}(${a1Of(active.row, left)}:${a1Of(active.row, active.col - 1)})`);
		});
	};

	const insertFunction = (fname: string) => {
		setBar(`=${fname}()`);
		setTimeout(() => {
			const el = barInput.current;
			if (!el) return;
			el.focus();
			el.setSelectionRange(fname.length + 2, fname.length + 2);
		}, 0);
	};

	const scrollRef = useRef({ left: 0, top: 0 });
	const insertChart = (kind: ChartSpec["kind"]) => {
		if (!sheet) return;
		const r = single ? dataRange() : selection;
		if (used.rows === 0 && single) return flash(false, "Type some numbers first, then choose the cells to chart.");
		const n = chartsOf(doc).toArray().filter((c) => c.sheet === sheet.id).length;
		const spec: ChartSpec = { id: Math.random().toString(36).slice(2, 10), sheet: sheet.id, range: rangeText(r), kind, title: "", x: scrollRef.current.left + 60 + n * 24, y: scrollRef.current.top + 40 + n * 24, w: 480, h: 300 };
		edit(() => chartsOf(doc).push([spec]));
		setChartId(spec.id);
		setTab("home");
	};
	const charts = useMemo(() => (sheet ? chartsOf(doc).toArray().filter((c) => c.sheet === sheet.id) : []), [doc, sheet, version]); // eslint-disable-line react-hooks/exhaustive-deps
	const [chartId, setChartId] = useState<string | null>(null);
	const changeChart = (id: string, patch: Partial<ChartSpec>) =>
		edit(() => {
			const list = chartsOf(doc);
			const i = list.toArray().findIndex((c) => c.id === id);
			if (i < 0) return;
			const cur = list.get(i);
			list.delete(i, 1);
			list.insert(i, [{ ...cur, ...patch }]);
		});
	const removeChart = (id: string) =>
		edit(() => {
			const i = chartsOf(doc).toArray().findIndex((c) => c.id === id);
			if (i >= 0) chartsOf(doc).delete(i, 1);
		});

	const setFreezeMode = (mode: "row" | "col" | "both" | "none") => {
		if (!sheet) return;
		edit(() => setFreeze(doc, sheet.id, ...(mode === "row" ? ([1, 0] as const) : mode === "col" ? ([0, 1] as const) : mode === "both" ? ([active.row, active.col] as const) : ([0, 0] as const))));
	};

	const autoFit = (col: number) => {
		if (!sheet) return;
		let longest = 0;
		for (let row = 0; row < Math.max(used.rows, 1) && row < 5000; row++) longest = Math.max(longest, shown[a1Of(row, col)]?.text.length ?? 0);
		edit(() => setWidth(doc, sheet.id, col, Math.min(400, Math.max(40, longest * 7.5 + 18))));
	};

	const paste = async () => {
		try {
			const text = await navigator.clipboard.readText();
			const { parseTsv } = await import("@/lib/sheet");
			const rows = parseTsv(text);
			if (rows.length > 0) onPaste({ row: selection.r0, col: selection.c0 }, rows);
		} catch {
			flash(false, "Press Ctrl+V in the grid to paste.");
		}
	};

	const saveCopy = async (ext: string) => {
		if (!sheet) return;
		try {
			const base = (rel.split("/").pop() ?? "workbook").replace(/\.[^.]+$/, "");
			const dest = await save({ title: "Save a copy", defaultPath: `${base}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
			if (!dest) return;
			const size = await sheetSave(workspacePath, dest, readWorkbookForFile(doc, COL_W), sheet.name);
			flash(true, `Saved a copy (${Math.max(1, Math.round(size / 1024))} KB).`);
		} catch (err) {
			flash(false, errorText(err, "The copy could not be saved."));
		}
	};
	const [confirmUpdate, setConfirmUpdate] = useState(false);
	const canUpdate = /\.xlsx$/i.test(rel);
	const updateFile = async () => {
		if (!sheet) return;
		try {
			await sheetSave(workspacePath, `${workspacePath.replace(/[\\/]+$/, "")}/${rel}`, readWorkbookForFile(doc, COL_W), sheet.name);
			setConfirmUpdate(false);
			flash(true, "The file now matches the workbook.");
			setTab("home");
		} catch (err) {
			flash(false, errorText(err, "The file could not be updated."));
		}
	};

	// What the chosen cells add up to, for the status bar
	const stats = useMemo(() => {
		let n = 0;
		let sum = 0;
		let seen = 0;
		for (let r = selection.r0; r <= selection.r1 && seen < 200_000; r++)
			for (let c = selection.c0; c <= selection.c1 && seen < 200_000; c++) {
				seen++;
				const v = shown[a1Of(r, c)]?.num;
				if (v !== undefined) {
					n++;
					sum += v;
				}
			}
		return { n, sum, count: seen };
	}, [selection, shown]);

	const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
	const quickBtn = "flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-white";

	if (!sheet) return <Loading className="h-48" />;

	const book = () => readWorkbook(doc);

	return (
		<OfficeFrame
			accent="excel"
			name={name}
			state={readOnly ? "Read-only" : "Shared"}
			tabs={TABS}
			tab={tab}
			onTab={setTab}
			quick={
				<>
					<button type="button" aria-label="Save a copy" title="Save a copy" onClick={() => setTab("file")} className={quickBtn}>
						<Save className="size-4" />
					</button>
					<button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={readOnly} onClick={() => undo.undo()} className={quickBtn}>
						<Undo2 className="size-4" />
					</button>
					<button type="button" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={readOnly} onClick={() => undo.redo()} className={quickBtn}>
						<Redo2 className="size-4" />
					</button>
				</>
			}
			people={<PeopleStack people={people} />}
			ribbon={
				<SheetRibbon
					tab={tab}
					look={activeLook}
					readOnly={readOnly}
					style={style}
					paste={() => void paste()}
					restructure={(op) => void restructure(op)}
					autoSum={autoSum}
					insertFunction={insertFunction}
					sort={(d) => void sort(d)}
					insertChart={insertChart}
					addSheet={() => edit(() => setActiveId(addSheet(doc).id))}
					freeze={freeze}
					setFreeze={setFreezeMode}
					view={view}
					setView={(v) => setView((cur) => ({ ...cur, ...v }))}
					clear={(what) => {
						if (what === "all") onClear(selection);
						style(() => ({}));
					}}
					openFile={() => setTab("file")}
					canSort={used.rows > 1}
				/>
			}
			file={
				<Backstage
					accent="#217346"
					onBack={() => setTab("home")}
					items={[
						{
							id: "info",
							label: "Info",
							icon: Info,
							panel: (
								<div className="max-w-md space-y-2 text-sm">
									<h2 className="mb-3 text-2xl font-light">{name}</h2>
									<p>
										{sheets.length} {sheets.length === 1 ? "sheet" : "sheets"}, {cellsOf(doc).size.toLocaleString()} cells with something in them.
									</p>
									{opened.notes.map((n) => (
										<p key={n} className="text-muted-foreground">{n}</p>
									))}
									<p className="text-muted-foreground">Charts and cell looks are saved into .xlsx copies. Pictures, pivot tables, merged cells and macros are not.</p>
								</div>
							),
						},
						{
							id: "save",
							label: "Save a Copy",
							icon: Download,
							panel: (
								<div className="max-w-md space-y-2">
									<h2 className="mb-3 text-2xl font-light">Save a Copy</h2>
									<p className="mb-3 text-sm text-muted-foreground">A copy goes where you choose and does not change the file in the workspace.</p>
									{FORMATS.map((f) => (
										<button key={f.ext} type="button" onClick={() => void saveCopy(f.ext)} className="block w-full border px-4 py-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
											{f.label}
										</button>
									))}
								</div>
							),
						},
						{
							id: "update",
							label: "Update the File",
							icon: FilePenLine,
							panel: (
								<div className="max-w-md space-y-3 text-sm">
									<h2 className="text-2xl font-light">Update the File</h2>
									<p>Replaces <b>{name}</b> in the workspace with what the workbook holds now. Everyone gets the new file.</p>
									{confirmUpdate ? (
										<div className="flex gap-2">
											<Button isDisabled={readOnly || !canUpdate} onPress={() => void updateFile()}>Replace It</Button>
											<Button variant="outline" onPress={() => setConfirmUpdate(false)}>Cancel</Button>
										</div>
									) : (
										<Button isDisabled={!canUpdate || readOnly} onPress={() => setConfirmUpdate(true)}>Replace the File…</Button>
									)}
									{!canUpdate && <p className="text-xs text-muted-foreground">Only .xlsx files can be replaced; save a copy to keep the others.</p>}
								</div>
							),
						},
						{ id: "close", label: "Close", icon: X, panel: <p className="text-sm text-muted-foreground">Choose the workbook tab to go back to the cells. Closing is done from the list of workbooks.</p> },
					]}
				/>
			}
			status={
				<>
					<span>Ready</span>
					{stats.n > 0 && (
						<>
							<span>Average: {(stats.sum / stats.n).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
							<span>Count: {stats.n.toLocaleString()}</span>
							<span>Sum: {stats.sum.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
						</>
					)}
				</>
			}
		>
			<div className="flex h-full min-h-0 flex-col">
				{notice && (
					<p role={notice.ok ? "status" : "alert"} className={cn("px-3 py-1.5 text-sm", notice.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
						{notice.text}
					</p>
				)}
				{opened.notes.length > 0 && <p className="border-b bg-muted/40 px-3 py-1 text-[13px] text-muted-foreground">{opened.notes.join(" ")}</p>}
				{view.formulaBar && (
					<div className="flex items-center gap-2 border-b px-2 py-1">
						<span className="w-20 shrink-0 border bg-background px-2 py-0.5 text-center font-mono text-[13px]">{single ? activeA1 : rangeText(selection)}</span>
						<span className="font-serif text-sm italic text-muted-foreground">fx</span>
						<input
							ref={barInput}
							aria-label="Formula bar"
							className="h-7 min-w-0 flex-1 border bg-background px-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
							readOnly={readOnly}
							value={bar ?? typed(activeA1)}
							onChange={(e) => setBar(e.target.value)}
							onBlur={() => {
								if (bar !== null && bar !== typed(activeA1)) onCommit(activeA1, bar);
								setBar(null);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									if (bar !== null) onCommit(activeA1, bar);
									setBar(null);
								} else if (e.key === "Escape") setBar(null);
							}}
						/>
					</div>
				)}
				<div className="min-h-0 flex-1">
					<SheetGrid
						key={sheet.id}
						rows={Math.max(1000, used.rows + 200)}
						cols={Math.max(52, used.cols + 10)}
						shown={shown}
						typed={typed}
						look={look}
						widths={widths}
						onWidth={(c, px) => edit(() => setWidth(doc, sheet.id, c, px))}
						onAutoFit={autoFit}
						freeze={freeze}
						showGrid={view.grid}
						scrollRef={scrollRef}
						readOnly={readOnly}
						others={others}
						active={active}
						selection={selection}
						onMove={(a, s) => {
							setActive(a);
							setSelection(s);
							setBar(null);
							setChartId(null);
						}}
						onCommit={onCommit}
						onClear={onClear}
						onPaste={onPaste}
						overlay={() =>
							charts.map((c) => (
								<ChartView key={c.id} spec={c} sheetName={sheet.name} book={book} version={version} selected={chartId === c.id} readOnly={readOnly} onSelect={() => setChartId(c.id)} onChange={(patch) => changeChart(c.id, patch)} onRemove={() => removeChart(c.id)} />
							))
						}
					/>
				</div>
				<div role="tablist" aria-label="Sheets" className="flex items-center gap-1 border-t bg-[#f3f2f1] px-2 py-1 dark:bg-neutral-800">
					{sheets.map((s) =>
						renaming?.id === s.id ? (
							<form
								key={s.id}
								onSubmit={(e) => {
									e.preventDefault();
									const problem = renameSheet(doc, s.id, renaming.value);
									if (problem) flash(false, problem);
									else {
										flash(true, "Renamed. Formulas that named the old name were not changed.");
										setRenaming(null);
									}
								}}
							>
								<input autoFocus aria-label="Sheet name" value={renaming.value} onChange={(e) => setRenaming({ id: s.id, value: e.target.value })} onBlur={() => setRenaming(null)} className="h-6 w-28 border bg-background px-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
							</form>
						) : (
							<button
								key={s.id}
								type="button"
								role="tab"
								aria-selected={s.id === sheet.id}
								onClick={() => setActiveId(s.id)}
								onDoubleClick={() => !readOnly && setRenaming({ id: s.id, value: s.name })}
								className={cn("px-3 py-0.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring", s.id === sheet.id ? "border-b-2 border-[#217346] bg-white font-semibold text-[#217346] dark:bg-neutral-900" : "text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10")}
							>
								{s.name}
							</button>
						),
					)}
					{!readOnly && (
						<>
							<button type="button" aria-label="Add a sheet" title="New sheet" onClick={() => edit(() => setActiveId(addSheet(doc).id))} className="flex size-6 items-center justify-center rounded-full text-base outline-none hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10">
								+
							</button>
							{sheets.length > 1 && (
								<button type="button" onClick={() => { const problem = deleteSheet(doc, sheet.id); if (problem) flash(false, problem); else setActiveId(null); }} className="px-2 text-xs text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring">
									Delete this sheet
								</button>
							)}
						</>
					)}
				</div>
			</div>
		</OfficeFrame>
	);
}
