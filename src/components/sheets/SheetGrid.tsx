import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { a1Of, colLetters, normalise, parseTsv, toTsv, type CellStyle, type Range, type Shown } from "@/lib/sheet";
import { cn } from "@/lib/utils";

const ROW_H = 24;
const HEAD_H = 24;
const HEAD_W = 48;
export const ROW_PX = ROW_H;
export const COL_W = 96;
const MAX_PASTE = 20_000;

export interface Other {
	name: string;
	color: string;
	row: number;
	col: number;
}

export interface Cursor {
	row: number;
	col: number;
}

interface Props {
	rows: number;
	cols: number;
	shown: Record<string, Shown>;
	typed: (a1: string) => string;
	readOnly: boolean;
	others: Other[];
	active: Cursor;
	selection: Range;
	onMove: (active: Cursor, selection: Range) => void;
	onCommit: (a1: string, text: string) => void;
	onClear: (r: Range) => void;
	onPaste: (at: Cursor, rows: string[][]) => void;
	// How a cell looks, the widths that differ from the standard one, and the rows and columns that stay in view
	look?: (a1: string) => CellStyle;
	widths?: Record<number, number>;
	onWidth?: (col: number, px: number) => void;
	freeze?: [number, number];
	showGrid?: boolean;
	// Where the cells are scrolled to, kept up to date for the page
	scrollRef?: { current: { left: number; top: number } };
	// Drawn over the cells, in grid coordinates (charts)
	overlay?: (box: (r: Range) => { left: number; top: number; width: number; height: number }) => ReactNode;
	// Called with a double click on a column edge's neighbour: fit the column to its text
	onAutoFit?: (col: number) => void;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// The grid: rows and columns drawn only where they are on screen, so a sheet of a million rows costs as much as one of a hundred.
// It owns scrolling, selection, typing into a cell and the clipboard; what a cell holds and shows comes from the page.
export default function SheetGrid({ rows, cols, shown, typed, readOnly, others, active, selection, onMove, onCommit, onClear, onPaste, look, widths: sharedWidths, onWidth, freeze = [0, 0], showGrid = true, overlay, onAutoFit, scrollRef }: Props) {
	const scroller = useRef<HTMLDivElement>(null);
	const root = useRef<HTMLDivElement>(null);
	const [scroll, setScroll] = useState({ left: 0, top: 0 });
	const [size, setSize] = useState({ w: 800, h: 480 });
	// A column being dragged wider shows its new width at once; the page keeps it for everyone when the drag ends
	const [drag, setDrag] = useState<{ col: number; px: number } | null>(null);
	const widths = useMemo(() => (drag ? { ...sharedWidths, [drag.col]: drag.px } : (sharedWidths ?? {})), [sharedWidths, drag]);
	const [editing, setEditingState] = useState<{ row: number; col: number; text: string } | null>(null);
	// The entry as the handlers see it right now: ending one must not be undone by the blur the removed field may send
	const editRef = useRef<typeof editing>(null);
	const setEditing = (e: typeof editing) => {
		editRef.current = e;
		setEditingState(e);
	};
	const dragging = useRef(false);
	const anchor = useRef<Cursor>(active);
	// The corner a Shift+arrow moves, which is not the cell the selection started from
	const end = useRef<Cursor>(active);

	const colW = useCallback((c: number) => widths[c] ?? COL_W, [widths]);
	const colX = useCallback(
		(c: number) => {
			let x = c * COL_W;
			for (const [k, w] of Object.entries(widths)) if (Number(k) < c) x += w - COL_W;
			return x;
		},
		[widths],
	);
	const totalW = colX(cols);
	const [frozenRows, frozenCols] = freeze;
	const totalH = rows * ROW_H;

	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// The rows and columns on screen, with a little beyond
	const r0 = Math.max(0, Math.floor(scroll.top / ROW_H) - 2);
	const r1 = Math.min(rows - 1, Math.ceil((scroll.top + size.h) / ROW_H) + 2);
	const { c0, c1 } = useMemo(() => {
		let a = 0;
		while (a < cols - 1 && colX(a + 1) <= scroll.left) a++;
		let b = a;
		while (b < cols - 1 && colX(b) < scroll.left + size.w) b++;
		return { c0: Math.max(0, a - 1), c1: Math.min(cols - 1, b + 1) };
	}, [scroll.left, size.w, cols, colX]);

	const reveal = useCallback(
		(row: number, col: number) => {
			const el = scroller.current;
			if (!el) return;
			const top = row * ROW_H;
			if (top < el.scrollTop) el.scrollTop = top;
			else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
			const left = colX(col);
			if (left < el.scrollLeft) el.scrollLeft = left;
			else if (left + colW(col) > el.scrollLeft + el.clientWidth) el.scrollLeft = left + colW(col) - el.clientWidth;
		},
		[colX, colW],
	);

	const moveTo = (row: number, col: number, extend: boolean) => {
		const next = { row: clamp(row, 0, rows - 1), col: clamp(col, 0, cols - 1) };
		if (!extend) anchor.current = next;
		end.current = next;
		onMove(extend ? { row: anchor.current.row, col: anchor.current.col } : next, normalise(anchor.current, next));
		reveal(next.row, next.col);
	};

	const commit = (move: "down" | "right" | "none") => {
		const current = editRef.current;
		if (!current) return;
		const { row, col, text } = current;
		setEditing(null);
		if (text !== typed(a1Of(row, col))) onCommit(a1Of(row, col), text);
		if (move === "down") moveTo(row + 1, col, false);
		else if (move === "right") moveTo(row, col + 1, false);
		root.current?.focus();
	};

	const startEdit = (initial?: string) => {
		if (readOnly) return;
		setEditing({ row: active.row, col: active.col, text: initial ?? typed(a1Of(active.row, active.col)) });
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (editing) return;
		const extend = e.shiftKey;
		const ctrl = e.ctrlKey || e.metaKey;
		const go = (dr: number, dc: number) => {
			e.preventDefault();
			const from = extend ? end.current : active;
			moveTo(from.row + dr, from.col + dc, extend);
		};
		switch (e.key) {
			case "ArrowDown":
				return ctrl ? (e.preventDefault(), moveTo(rows - 1, active.col, extend)) : go(1, 0);
			case "ArrowUp":
				return ctrl ? (e.preventDefault(), moveTo(0, active.col, extend)) : go(-1, 0);
			case "ArrowRight":
				return go(0, 1);
			case "ArrowLeft":
				return go(0, -1);
			case "PageDown":
				return go(20, 0);
			case "PageUp":
				return go(-20, 0);
			case "Home":
				e.preventDefault();
				return moveTo(ctrl ? 0 : active.row, 0, extend);
			case "Tab":
				e.preventDefault();
				return moveTo(active.row, active.col + (e.shiftKey ? -1 : 1), false);
			case "Enter":
				e.preventDefault();
				return e.shiftKey ? moveTo(active.row - 1, active.col, false) : startEdit();
			case "F2":
				e.preventDefault();
				return startEdit();
			case "Delete":
			case "Backspace":
				if (readOnly) return;
				e.preventDefault();
				return onClear(selection);
			case "a":
			case "A":
				if (ctrl) {
					e.preventDefault();
					anchor.current = { row: 0, col: 0 };
					onMove(active, { r0: 0, c0: 0, r1: Math.min(rows - 1, 999), c1: Math.min(cols - 1, 51) });
				}
				return;
		}
		// Typing starts an entry that replaces the cell
		if (!ctrl && !e.altKey && e.key.length === 1) {
			e.preventDefault();
			startEdit(e.key);
		}
	};

	const cellAt = (e: React.MouseEvent): Cursor | null => {
		const t = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
		return t ? { row: Number(t.dataset.r), col: Number(t.dataset.c) } : null;
	};

	useEffect(() => {
		const up = () => (dragging.current = false);
		window.addEventListener("mouseup", up);
		return () => window.removeEventListener("mouseup", up);
	}, []);

	const copy = (e: React.ClipboardEvent, cut: boolean) => {
		if (editing) return;
		e.preventDefault();
		const lines: string[][] = [];
		for (let r = selection.r0; r <= selection.r1; r++) {
			const line: string[] = [];
			for (let c = selection.c0; c <= selection.c1; c++) {
				const t = typed(a1Of(r, c));
				line.push(/[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
			}
			lines.push(line);
		}
		e.clipboardData.setData("text/plain", toTsv(lines));
		if (cut && !readOnly) onClear(selection);
	};

	const paste = (e: React.ClipboardEvent) => {
		if (editing || readOnly) return;
		const rowsIn = parseTsv(e.clipboardData.getData("text/plain"));
		if (rowsIn.length === 0) return;
		e.preventDefault();
		if (rowsIn.reduce((n, r) => n + r.length, 0) > MAX_PASTE) return;
		onPaste({ row: selection.r0, col: selection.c0 }, rowsIn);
	};

	// The frozen rows and columns are always drawn, wherever the rest has scrolled to
	const visibleRows = useMemo(() => {
		const list = Array.from({ length: Math.max(0, r1 - r0 + 1) }, (_, i) => r0 + i).filter((r) => r >= frozenRows);
		return [...Array.from({ length: frozenRows }, (_, i) => i), ...list];
	}, [r0, r1, frozenRows]);
	const visibleCols = useMemo(() => {
		const list = Array.from({ length: Math.max(0, c1 - c0 + 1) }, (_, i) => c0 + i).filter((c) => c >= frozenCols);
		return [...Array.from({ length: frozenCols }, (_, i) => i), ...list];
	}, [c0, c1, frozenCols]);
	const box = (r: Range) => ({ left: colX(r.c0), top: r.r0 * ROW_H, width: colX(r.c1 + 1) - colX(r.c0), height: (r.r1 - r.r0 + 1) * ROW_H });

	return (
		<div
			ref={root}
			tabIndex={0}
			role="grid"
			aria-label="Spreadsheet"
			aria-rowcount={rows}
			aria-colcount={cols}
			onKeyDown={onKeyDown}
			onCopy={(e) => copy(e, false)}
			onCut={(e) => copy(e, true)}
			onPaste={paste}
			className="relative h-full w-full select-none overflow-hidden bg-background text-[13px] outline-none"
		>
			<div className="absolute top-0 left-0 z-20 border-r border-b bg-muted" style={{ width: HEAD_W, height: HEAD_H }} />
			<div className="absolute top-0 right-0 z-10 overflow-hidden border-b bg-muted" style={{ left: HEAD_W, height: HEAD_H }}>
				<div className="relative" style={{ width: totalW, transform: `translateX(${-scroll.left}px)`, height: HEAD_H }}>
					{visibleCols.map((c) => (
						<div key={c} className={cn("absolute top-0 flex items-center justify-center border-r text-muted-foreground", c >= active.col && c <= active.col && "bg-primary/15 text-foreground", c >= selection.c0 && c <= selection.c1 && "bg-primary/10")} style={{ left: colX(c), width: colW(c), height: HEAD_H }}>
							{colLetters(c)}
							<span
									className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize"
									onDoubleClick={(e) => {
										e.stopPropagation();
										onAutoFit?.(c);
									}}
								onMouseDown={(e) => {
									e.preventDefault();
									const startX = e.clientX;
									const start = colW(c);
									let last = start;
										const move = (ev: MouseEvent) => {
											last = Math.max(32, start + ev.clientX - startX);
											setDrag({ col: c, px: last });
										};
										const up = () => {
											window.removeEventListener("mousemove", move);
											window.removeEventListener("mouseup", up);
											setDrag(null);
											if (last !== start) onWidth?.(c, last);
										};
									window.addEventListener("mousemove", move);
									window.addEventListener("mouseup", up);
								}}
							/>
						</div>
					))}
				</div>
			</div>
			<div className="absolute bottom-0 left-0 z-10 overflow-hidden border-r bg-muted" style={{ top: HEAD_H, width: HEAD_W }}>
				<div className="relative" style={{ height: totalH, transform: `translateY(${-scroll.top}px)` }}>
					{visibleRows.map((r) => (
						<div key={r} className={cn("absolute left-0 flex items-center justify-center border-b text-muted-foreground", r >= selection.r0 && r <= selection.r1 && "bg-primary/10", r === active.row && "bg-primary/15 text-foreground")} style={{ top: r * ROW_H, height: ROW_H, width: HEAD_W }}>
							{r + 1}
						</div>
					))}
				</div>
			</div>

			<div ref={scroller} className="absolute right-0 bottom-0 overflow-auto" style={{ left: HEAD_W, top: HEAD_H }} onScroll={(e) => {
					const at = { left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop };
					if (scrollRef) scrollRef.current = at;
					setScroll(at);
				}}>
				<div
					className="relative"
					style={{ width: totalW, height: totalH }}
					onMouseDown={(e) => {
						const at = cellAt(e);
						if (!at || editing) return;
						dragging.current = true;
						root.current?.focus();
						moveTo(at.row, at.col, e.shiftKey);
					}}
					onMouseMove={(e) => {
						if (!dragging.current) return;
						const at = cellAt(e);
						if (at) moveTo(at.row, at.col, true);
					}}
					onDoubleClick={() => startEdit()}
				>
					{visibleRows.map((r) =>
						visibleCols.map((c) => {
								const a1 = a1Of(r, c);
								const s = shown[a1];
								const lk = look?.(a1);
								const stuck = r < frozenRows || c < frozenCols;
								const align = lk?.align ?? (s?.kind === "number" ? "right" : s?.kind === "bool" ? "center" : "left");
								const line = (side: string) => (lk?.borders?.includes(side) ? "1px solid #404040" : undefined);
								return (
									<div
										key={a1}
										role="gridcell"
										aria-colindex={c + 1}
										aria-rowindex={r + 1}
										data-r={r}
										data-c={c}
										className={cn("absolute overflow-hidden px-1.5 leading-6", showGrid && "border-r border-b", lk?.wrap ? "whitespace-normal leading-[1.15]" : "whitespace-nowrap", s?.kind === "error" && "text-destructive", stuck && "z-[5]", stuck && !lk?.fill && "bg-background", r === frozenRows - 1 && frozenRows > 0 && "border-b-foreground/40", c === frozenCols - 1 && frozenCols > 0 && "border-r-foreground/40")}
										style={{
											left: c < frozenCols ? scroll.left + colX(c) : colX(c),
											top: r < frozenRows ? scroll.top + r * ROW_H : r * ROW_H,
											width: colW(c),
											height: ROW_H,
											textAlign: align,
											background: lk?.fill,
											color: s?.kind === "error" ? undefined : lk?.color,
											fontWeight: lk?.bold ? 700 : undefined,
											fontStyle: lk?.italic ? "italic" : undefined,
											textDecoration: [lk?.underline ? "underline" : "", lk?.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
											fontSize: lk?.size ? `${lk.size * (13 / 11)}px` : undefined,
											fontFamily: lk?.font,
											borderLeft: line("l"),
											borderTop: line("t"),
											...(lk?.borders?.includes("r") ? { borderRight: "1px solid #404040" } : null),
											...(lk?.borders?.includes("b") ? { borderBottom: "1px solid #404040" } : null),
										}}
									>
										{s?.text}
									</div>
								);
						}),
					)}
						{overlay?.(box)}
						<div className="pointer-events-none absolute border border-primary bg-primary/10" style={box(selection)} />
					<div className="pointer-events-none absolute border-2 border-primary" style={box({ r0: active.row, c0: active.col, r1: active.row, c1: active.col })} />
					{others.map((o) => (
						<div key={`${o.name}${o.row}${o.col}`} className="pointer-events-none absolute border-2" style={{ ...box({ r0: o.row, c0: o.col, r1: o.row, c1: o.col }), borderColor: o.color }}>
							<span className="absolute -top-4 left-0 px-1 text-[11px] leading-4 text-white" style={{ background: o.color }}>
								{o.name}
							</span>
						</div>
					))}
					{editing && (
						<input
							autoFocus
							aria-label={`Edit ${a1Of(editing.row, editing.col)}`}
							value={editing.text}
							onChange={(e) => setEditing({ ...editing, text: e.target.value })}
							onBlur={() => commit("none")}
							onKeyDown={(e) => {
								e.stopPropagation();
								if (e.key === "Enter") {
									e.preventDefault();
									commit(e.shiftKey ? "none" : "down");
								} else if (e.key === "Tab") {
									e.preventDefault();
									commit("right");
								} else if (e.key === "Escape") {
									setEditing(null);
									root.current?.focus();
								}
							}}
							className="absolute z-10 bg-background px-1.5 font-[inherit] ring-2 ring-primary outline-none"
							style={{ left: colX(editing.col), top: editing.row * ROW_H, width: Math.max(colW(editing.col), 140), height: ROW_H }}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
