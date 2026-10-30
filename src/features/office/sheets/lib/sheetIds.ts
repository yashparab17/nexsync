// Rows and columns that keep their identity. A cell used to be stored under its address ("Sheet!C7"), and inserting a row rewrote every
// address below it, so two people who edited while apart could end with a number in the wrong cell (RESEARCH.md §8m: 14% to 54% of typed
// numbers in simulation, and 18% to 92% of formulas pointing at the wrong cells). Here every row and every column has an id, a cell is stored
// under the pair of ids, a formula holds ids where it names cells, and inserting or deleting a row or column changes only the list of ids.
//
// The list of a sheet's rows is a shared array of ids. The first rows have the ids r0, r1, ... (and columns c0, c1, ...) and need not be in
// the list until something is inserted or deleted: a position past the end of the list is the next id in that run. Two people who
// extend the list at once push the same ids, and a repeated id is dropped when it is read. A row that was inserted has a random id, and a
// deleted one stays in the list, marked, so a cell somebody wrote into it meanwhile is simply not shown.

import * as Y from "yjs";

export type Axis = "rows" | "cols";

const prefix = (axis: Axis) => (axis === "rows" ? "r" : "c");
const orderOf = (doc: Y.Doc, sid: string, axis: Axis) => doc.getArray<string>(`${axis}:${sid}`);
const deadOf = (doc: Y.Doc) => doc.getMap<boolean>("axisDead");

export interface Layout {
	// Every id in order, the ones still shown, where each of those is, and where each of all of them is
	all: string[];
	live: string[];
	pos: Map<string, number>;
	slot: Map<string, number>;
	// The first number of the run of ids that is not in the list yet
	next: number;
}

function build(doc: Y.Doc, sid: string, axis: Axis): Layout {
	const all: string[] = [];
	const seen = new Set<string>();
	for (const id of orderOf(doc, sid, axis).toArray()) {
		if (seen.has(id)) continue;
		seen.add(id);
		all.push(id);
	}
	const dead = deadOf(doc);
	const live = all.filter((id) => !dead.get(`${sid}!${id}`));
	let next = 0;
	for (const id of all) {
		const m = /^[rc](\d+)$/.exec(id);
		if (m) next = Math.max(next, Number(m[1]) + 1);
	}
	return { all, live, pos: new Map(live.map((id, i) => [id, i])), slot: new Map(all.map((id, i) => [id, i])), next };
}

const caches = new WeakMap<Y.Doc, { layouts: Map<string, Layout>; watching: Set<string> }>();

export function layoutOf(doc: Y.Doc, sid: string, axis: Axis): Layout {
	let c = caches.get(doc);
	if (!c) {
		const made = { layouts: new Map<string, Layout>(), watching: new Set<string>() };
		c = made;
		caches.set(doc, made);
		deadOf(doc).observe(() => made.layouts.clear());
	}
	const key = `${axis}:${sid}`;
	if (!c.watching.has(key)) {
		const cache = c;
		c.watching.add(key);
		orderOf(doc, sid, axis).observe(() => cache.layouts.delete(key));
	}
	let l = c.layouts.get(key);
	if (!l) {
		l = build(doc, sid, axis);
		c.layouts.set(key, l);
	}
	return l;
}

// The id of the row or column at a position; past the end of the list it is the next id of the run
export function idAt(doc: Y.Doc, sid: string, axis: Axis, position: number): string {
	const l = layoutOf(doc, sid, axis);
	return l.live[position] ?? `${prefix(axis)}${l.next + (position - l.live.length)}`;
}

// Where an id is now, or null when it was deleted or is not known
export function positionOf(doc: Y.Doc, sid: string, axis: Axis, id: string): number | null {
	const l = layoutOf(doc, sid, axis);
	const p = l.pos.get(id);
	if (p !== undefined) return p;
	const m = /^[rc](\d+)$/.exec(id);
	if (m && !l.slot.has(id) && Number(m[1]) >= l.next) return l.live.length + (Number(m[1]) - l.next);
	return null;
}

// The nearest position still shown at or after (or at or before) where a deleted id was, for the end of a range
function nearest(doc: Y.Doc, sid: string, axis: Axis, id: string, direction: 1 | -1): number | null {
	const l = layoutOf(doc, sid, axis);
	const here = positionOf(doc, sid, axis, id);
	if (here !== null) return here;
	const slot = l.slot.get(id);
	if (slot === undefined) return null;
	for (let i = slot + direction; i >= 0 && i < l.all.length; i += direction) {
		const p = l.pos.get(l.all[i]);
		if (p !== undefined) return p;
	}
	return direction === 1 ? (l.live.length > 0 ? l.live.length : null) : null;
}

const newId = (axis: Axis) => `${prefix(axis) === "r" ? "i" : "j"}${Math.random().toString(36).slice(2, 10)}`;

// Puts the ids up to a position into the list, so something can be put in among them
function materialise(doc: Y.Doc, sid: string, axis: Axis, length: number) {
	const l = build(doc, sid, axis);
	if (l.live.length >= length) return;
	const ids: string[] = [];
	for (let i = 0; i < length - l.live.length; i++) ids.push(`${prefix(axis)}${l.next + i}`);
	orderOf(doc, sid, axis).push(ids);
}

// Inserts `count` empty rows or columns before the one at position `at`; returns their ids
export function insertAxis(doc: Y.Doc, sid: string, axis: Axis, at: number, count: number): string[] {
	const ids = Array.from({ length: count }, () => newId(axis));
	doc.transact(() => {
		materialise(doc, sid, axis, at);
		const l = build(doc, sid, axis);
		const arr = orderOf(doc, sid, axis);
		const before = at < l.live.length ? arr.toArray().indexOf(l.live[at]) : arr.length;
		arr.insert(before, ids);
	});
	return ids;
}

// Deletes `count` rows or columns from position `at`; returns their ids, so what was written in them can be cleared
export function deleteAxis(doc: Y.Doc, sid: string, axis: Axis, at: number, count: number): string[] {
	let gone: string[] = [];
	doc.transact(() => {
		materialise(doc, sid, axis, at + count);
		gone = build(doc, sid, axis).live.slice(at, at + count);
		const dead = deadOf(doc);
		for (const id of gone) dead.set(`${sid}!${id}`, true);
	});
	return gone;
}

// Forgets a sheet's lists
export function dropAxes(doc: Y.Doc, sid: string) {
	for (const axis of ["rows", "cols"] as Axis[]) {
		const arr = orderOf(doc, sid, axis);
		if (arr.length > 0) arr.delete(0, arr.length);
	}
	const dead = deadOf(doc);
	for (const key of [...dead.keys()]) if (key.startsWith(`${sid}!`)) dead.delete(key);
}

// ── a cell's key ──

export const cellKeyOf = (sid: string, rowId: string, colId: string) => `${sid}!${rowId}.${colId}`;

export function parseCellKey(key: string): { sid: string; rowId: string; colId: string } | null {
	const bang = key.indexOf("!");
	const rest = key.slice(bang + 1);
	const dot = rest.indexOf(".");
	if (bang < 0 || dot < 0) return null;
	return { sid: key.slice(0, bang), rowId: rest.slice(0, dot), colId: rest.slice(dot + 1) };
}

// ── formulas: names of cells as ids ──

const letters = (col: number): string => {
	let n = col + 1;
	let out = "";
	while (n > 0) {
		out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
		n = Math.floor((n - 1) / 26);
	}
	return out;
};
const lettersCol = (s: string): number => [...s.toUpperCase()].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
const MAX_ROWS = 1_048_576;
const MAX_COLS = 16_384;

// A cell name, with a sheet name before it or not; not part of a longer word, and not a function (LOG10( )
const REF = /(?<![A-Za-z0-9_.])((?:'[^']+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w(])/g;
const TOKEN = /((?:'[^']+'|[A-Za-z_][\w.]*)!)?⟦(\$?)([^.⟧]+)\.(\$?)([^⟧]+)⟧/g;

function sheetIdFor(doc: Y.Doc, qualifier: string | undefined, own: string): string | null {
	if (!qualifier) return own;
	const name = qualifier.slice(0, -1).replace(/^'|'$/g, "").toLowerCase();
	const hit = doc.getArray<{ id: string; name: string }>("sheets").toArray().find((s) => s.name.toLowerCase() === name);
	return hit ? hit.id : null;
}

// Pieces of a formula outside its quoted text
function outsideQuotes(text: string, f: (piece: string) => string): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		if (text[i] === '"') {
			let j = i + 1;
			while (j < text.length && !(text[j] === '"' && text[j + 1] !== '"')) j += text[j] === '"' ? 2 : 1;
			out += text.slice(i, j + 1);
			i = j + 1;
		} else {
			let j = i;
			while (j < text.length && text[j] !== '"') j++;
			out += f(text.slice(i, j));
			i = j;
		}
	}
	return out;
}

// A formula as it is stored: each cell it names becomes the ids of its row and column
export function encodeFormula(doc: Y.Doc, sid: string, text: string): string {
	if (!text.startsWith("=")) return text;
	return outsideQuotes(text, (piece) =>
		piece.replace(REF, (all, qualifier: string | undefined, ra: string, col: string, ca: string, row: string) => {
			const c = lettersCol(col);
			const r = Number(row) - 1;
			const target = sheetIdFor(doc, qualifier, sid);
			if (target === null || c < 0 || c >= MAX_COLS || r < 0 || r >= MAX_ROWS) return all;
			return `${qualifier ?? ""}⟦${ca}${idAt(doc, target, "rows", r)}.${ra}${idAt(doc, target, "cols", c)}⟧`;
		}),
	);
}

// A stored formula as people type and read it: the ids turned back into names of cells where they are now; a cell that is gone is #REF!,
// and the end of a range that is gone moves to the nearest row or column still there
export function decodeFormula(doc: Y.Doc, sid: string, text: string): string {
	if (!text.includes("⟦")) return text;
	const name = (qualifier: string | undefined, rowAbs: string, rowId: string, colAbs: string, colId: string, side: "single" | "start" | "end") => {
		const target = sheetIdFor(doc, qualifier, sid);
		if (target === null) return null;
		const row = side === "single" ? positionOf(doc, target, "rows", rowId) : nearest(doc, target, "rows", rowId, side === "start" ? 1 : -1);
		const col = side === "single" ? positionOf(doc, target, "cols", colId) : nearest(doc, target, "cols", colId, side === "start" ? 1 : -1);
		return row === null || col === null ? null : { text: `${qualifier ?? ""}${colAbs}${letters(col)}${rowAbs}${row + 1}`, row, col };
	};
	const RANGE = /((?:'[^']+'|[A-Za-z_][\w.]*)!)?⟦(\$?)([^.⟧]+)\.(\$?)([^⟧]+)⟧:((?:'[^']+'|[A-Za-z_][\w.]*)!)?⟦(\$?)([^.⟧]+)\.(\$?)([^⟧]+)⟧/g;
	return outsideQuotes(text, (piece) =>
		piece
			.replace(RANGE, (_all, q1, ra1, r1, ca1, c1, q2, ra2, r2, ca2, c2) => {
				const a = name(q1, ra1, r1, ca1, c1, "start");
				const b = name(q2, ra2, r2, ca2, c2, "end");
				return a && b && a.row <= b.row && a.col <= b.col ? `${a.text}:${b.text}` : "#REF!";
			})
			.replace(TOKEN, (_all, q, ra, r, ca, c) => name(q, ra, r, ca, c, "single")?.text ?? "#REF!"),
	);
}

// ── documents saved with cells under their addresses ──

const A1 = /^([A-Za-z]{1,3})(\d{1,7})$/;
const upgraded = new WeakSet<Y.Doc>();

// Moves what was stored under addresses to ids (cells, looks and column widths). Every device that does it writes the same keys, since the
// first ids are the numbers of the positions, so two doing it at once agree.
export function upgradeSheets(doc: Y.Doc) {
	const cells = doc.getMap<string>("cells");
	const looks = doc.getMap<string>("looks");
	const widths = doc.getMap<number>("widths");
	const old = (m: { keys(): IterableIterator<string> }) => [...m.keys()].filter((k) => !k.includes(".") && A1.test(k.slice(k.indexOf("!") + 1)));
	const oldWidths = [...widths.keys()].filter((k) => /^[A-Z]{1,3}$/.test(k.slice(k.indexOf("!") + 1)));
	if (old(cells).length === 0 && old(looks).length === 0 && oldWidths.length === 0) return;
	doc.transact(() => {
		for (const [map, encode] of [[cells, true], [looks, false]] as [Y.Map<string>, boolean][]) {
			for (const key of old(map)) {
				const sid = key.slice(0, key.indexOf("!"));
				const m = A1.exec(key.slice(key.indexOf("!") + 1))!;
				const row = Number(m[2]) - 1;
				const col = lettersCol(m[1]);
				const value = map.get(key)!;
				const next = cellKeyOf(sid, idAt(doc, sid, "rows", row), idAt(doc, sid, "cols", col));
				map.set(next, encode ? encodeFormula(doc, sid, value) : value);
				map.delete(key);
			}
		}
		for (const key of oldWidths) {
			const sid = key.slice(0, key.indexOf("!"));
			const px = widths.get(key)!;
			widths.set(`${sid}!${idAt(doc, sid, "cols", lettersCol(key.slice(key.indexOf("!") + 1)))}`, px);
			widths.delete(key);
		}
	}, "upgrade");
}

// Upgrades a document once, and again if an older copy of the app sends cells under addresses later
export function ensureUpgraded(doc: Y.Doc) {
	if (upgraded.has(doc)) return;
	upgraded.add(doc);
	upgradeSheets(doc);
	doc.getMap("cells").observe((event) => {
		if (event.transaction.origin === "upgrade") return;
		for (const key of event.keysChanged) if (!key.includes(".") && A1.test(key.slice(key.indexOf("!") + 1))) return upgradeSheets(doc);
	});
}
