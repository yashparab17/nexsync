// Draws each block the way its Word paragraph properties (see `WORD_PROPS` in documentSchema) say: the space above and below, the
// indents, the line height (its font's own, times the line spacing), the paragraph mark's font and size, a contents line's right tab,
// and a list's label, numbered as the list stands now. It does this with ProseMirror decorations on the blocks, so nothing about the
// look is written into the text, and the attributes the paginator reads (data-nx-brk, -keep, -valign, -after) are on the block's content
// element. (On the content, not the block: decorations on the blocks themselves all sit in one list, which every key typed maps again.)
//
// Documents put in before blocks carried these properties keep theirs in a separate map, keyed by block id (`ParaSpacing`); those are
// drawn the same way until the document is reloaded from its file.

import { Plugin, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

import { lineFactor } from "@/features/office/documents/lib/fontMetrics";

// One level of a Word list, as the backend sends it (`num:level` → level)
export interface ListLevel {
	abs: number;
	format: string;
	text: string;
	start: number;
	restart: boolean;
	// The font the label is drawn in (a bullet's is often Symbol), whose line height lifts the item's first line
	font?: string;
}

// The spacing a document put in before blocks had properties keeps in its separate map
export interface ParaSpacing {
	before: number;
	after: number;
	left: number;
	first: number;
	toc: boolean;
	brk?: boolean;
	valign?: string;
	keep?: boolean;
	line?: number;
	size?: number;
	font?: string;
}

// What the block is drawn with, from its own properties or from the old map
interface Look {
	spaceBefore: number;
	spaceAfter: number;
	lineSpacing: number;
	indentLeft: number;
	indentRight: number;
	indentFirst: number;
	keepNext: boolean;
	pageBreakBefore: boolean;
	sectionVAlign: string;
	tabRight: boolean;
	markFont: string;
	markSize: number;
	numId: number;
	ilvl: number;
	listLabel: string;
	descent: number;
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clampPt = (v: number) => Math.max(-500, Math.min(500, v));
// Font names go into a style attribute: nothing that could end it
const safeFont = (f: unknown) => (typeof f === "string" ? f.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 64) : "");

function lookOf(attrs: Record<string, unknown>, legacy: ParaSpacing | undefined): Look | null {
	if (num(attrs.spaceAfter, -1) >= 0 || num(attrs.lineSpacing, 0) !== 0 || num(attrs.numId, 0) > 0 || attrs.pageBreakBefore === true) {
		return {
			spaceBefore: clampPt(num(attrs.spaceBefore, 0)),
			spaceAfter: clampPt(num(attrs.spaceAfter, 0)),
			lineSpacing: num(attrs.lineSpacing, 0),
			indentLeft: clampPt(num(attrs.indentLeft, 0)),
			indentRight: clampPt(num(attrs.indentRight, 0)),
			indentFirst: clampPt(num(attrs.indentFirst, 0)),
			keepNext: attrs.keepNext === true,
			pageBreakBefore: attrs.pageBreakBefore === true,
			sectionVAlign: typeof attrs.sectionVAlign === "string" ? attrs.sectionVAlign : "",
			tabRight: attrs.tabRight === true,
			markFont: safeFont(attrs.markFont),
			markSize: Math.max(0, Math.min(400, num(attrs.markSize, 0))),
			numId: num(attrs.numId, 0),
			ilvl: Math.max(0, Math.min(8, num(attrs.ilvl, 0))),
			listLabel: typeof attrs.listLabel === "string" ? attrs.listLabel : "",
			descent: Math.max(0, Math.min(50, num(attrs.descent, 0))),
		};
	}
	if (!legacy) return null;
	return {
		spaceBefore: legacy.before,
		spaceAfter: legacy.after,
		lineSpacing: legacy.line ?? 0,
		indentLeft: legacy.left,
		indentRight: 0,
		indentFirst: legacy.first,
		keepNext: !!legacy.keep,
		pageBreakBefore: !!legacy.brk,
		sectionVAlign: legacy.valign ?? "",
		tabRight: legacy.toc,
		markFont: safeFont(legacy.font),
		markSize: legacy.size ?? 0,
		numId: 0,
		ilvl: 0,
		listLabel: "",
		descent: 0,
	};
}

// A list number in a level's format
export function formatNumber(n: number, format: string): string {
	const letters = (v: number) => {
		let s = "";
		for (let x = v; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(97 + ((x - 1) % 26)) + s;
		return s;
	};
	const roman = (v: number) => {
		const table: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
		let s = "";
		let x = v;
		for (const [k, r] of table) for (; x >= k; x -= k) s += r;
		return s;
	};
	switch (format) {
		case "lowerLetter":
			return letters(n);
		case "upperLetter":
			return letters(n).toUpperCase();
		case "lowerRoman":
			return roman(n);
		case "upperRoman":
			return roman(n).toUpperCase();
		case "none":
			return "";
		default:
			return String(n);
	}
}

// Numbers lists as Word does while walking the document in order: each list definition (`abs`) keeps a count per level; an item adds
// one at its level and starts the levels below it again
export class ListCounter {
	private counts = new Map<number, number[]>();
	constructor(private lists: Record<string, ListLevel>) {}

	label(numId: number, ilvl: number, fallback: string): string {
		const def = this.lists[`${numId}:${ilvl}`];
		if (!def) return fallback;
		if (def.format === "bullet") return def.text;
		const c = this.counts.get(def.abs) ?? Array(9).fill(0);
		c[ilvl] = c[ilvl] > 0 ? c[ilvl] + 1 : def.start;
		for (let d = ilvl + 1; d < 9; d++) if (this.lists[`${numId}:${d}`]?.restart !== false) c[d] = 0;
		this.counts.set(def.abs, c);
		return def.text.replace(/%([1-9])/g, (_, k: string) => {
			const lvl = Number(k) - 1;
			const levelDef = this.lists[`${numId}:${lvl}`];
			return formatNumber(c[lvl] || levelDef?.start || 1, levelDef?.format ?? "decimal");
		});
	}
}

const outerStyle = (l: Look) =>
	[
		l.lineSpacing > 0 && `--nx-mult:${l.lineSpacing}`,
		l.lineSpacing < 0 && `--nx-exact:${-l.lineSpacing}pt`,
		l.markFont && `--nx-lf:${lineFactor(l.markFont)};font-family:'${l.markFont}'`,
		l.markSize > 0 && `font-size:${l.markSize}pt`,
		l.spaceBefore > 0 && `border-top:${l.spaceBefore}pt solid transparent`,
		// (a picture's line goes on below it by its font's descent, as an inline picture's does in Word)
		`padding-bottom:${Math.max(0, l.spaceAfter) + Math.max(0, l.descent)}pt`,
		l.indentLeft > 0 && `padding-left:${l.indentLeft}pt`,
		l.indentRight > 0 && `padding-right:${l.indentRight}pt`,
		// A list item's first line starts at its indent, after its label, which hangs in front (see the inner decoration)
		!l.numId && l.indentFirst !== 0 && l.indentLeft + l.indentFirst >= 0 && `text-indent:${l.indentFirst}pt`,
	]
		.filter(Boolean)
		.join(";");

interface State {
	legacy: Map<string, ParaSpacing>;
	lists: Record<string, ListLevel>;
	set: DecorationSet;
}

// The smallest text run of a block: its size (points) and font
function smallestRun(content: PMNode): { size: number; font: string } | null {
	let best: { size: number; font: string } | null = null;
	content.descendants((n) => {
		if (!n.isText || !n.text?.trim()) return true;
		let size = 0;
		let font = "";
		for (const m of n.marks) {
			const v = m.attrs.stringValue as string | undefined;
			if (m.type.name === "fontSize" && v) size = Number.parseFloat(v);
			else if (m.type.name === "fontFamily" && v) font = v;
		}
		if (size > 0 && (!best || size < best.size)) best = { size, font };
		return false;
	});
	return best;
}

// The decorations of one block (`node`, a blockContainer at `pos`); a list item is numbered by `counter` (without one, it shows the label
// it carries)
function decorateBlock(node: PMNode, pos: number, decos: Decoration[], legacy: Map<string, ParaSpacing>, lists: Record<string, ListLevel>, counter: ListCounter | null) {
	const content = node.firstChild;
	const look = content ? lookOf(content.attrs, legacy.get(node.attrs.id as string)) : null;
	if (!look || !content) return;
	const label = look.numId > 0 && counter ? counter.label(look.numId, look.ilvl, look.listLabel) : look.listLabel;
	// A line is as tall as its text, never the paragraph mark (Word lets the mark set only an empty paragraph's line), so a paragraph
	// with text takes its block font from its smallest run, below which no line of it goes
	const small = smallestRun(content);
	if (small) {
		look.markSize = small.size;
		look.markFont = safeFont(small.font) || look.markFont;
	}
	const attrs: Record<string, string> = {
		class: ["nx-sp", look.tabRight && "nx-toc", look.lineSpacing < 0 && "nx-exact", label && "nx-list nx-label"].filter(Boolean).join(" "),
		style: outerStyle(look),
		"data-nx-after": String(Math.max(0, look.spaceAfter)),
		...(look.pageBreakBefore ? { "data-nx-brk": "1" } : {}),
		...(look.sectionVAlign ? { "data-nx-valign": look.sectionVAlign } : {}),
		...(look.keepNext ? { "data-nx-keep": "1" } : {}),
	};
	if (label) {
		// The label hangs in front of the first line, at the first-line indent (Word's hanging indent), on that line, so its font's
		// line height counts for the line as in Word
		const hang = look.indentFirst < 0 ? look.indentFirst : -18;
		const font = lists[`${look.numId}:${look.ilvl}`]?.font;
		const css = JSON.stringify(label).replace(/[<>;]/g, "");
		attrs["data-nx-label"] = label;
		attrs.style += `;--nx-label:${css};--nx-hang:${hang}pt${font ? `;--nx-label-lf:${lineFactor(font)}` : ""}`;
	}
	decos.push(Decoration.node(pos + 1, pos + 1 + content.nodeSize, attrs));
	if (look.tabRight) {
		// A contents line: the tab is hidden and what follows it floats to the right edge, as Word's right tab puts it
		const start = pos + 2;
		let tab = -1;
		content.descendants((n, p) => {
			if (tab < 0 && n.isText && n.text!.includes("\t")) tab = start + p + n.text!.indexOf("\t");
			return tab < 0;
		});
		const end = start + content.content.size;
		if (tab >= 0 && tab + 1 < end) {
			decos.push(Decoration.inline(tab, tab + 1, { class: "nx-toc-tab" }));
			// ponytail: a number split across differently styled runs floats as pieces in reverse order; page numbers are one run
			decos.push(Decoration.inline(tab + 1, end, { class: "nx-toc-num" }));
		}
	}
}

function decorate(doc: PMNode, legacy: Map<string, ParaSpacing>, lists: Record<string, ListLevel>): DecorationSet {
	const decos: Decoration[] = [];
	const counter = new ListCounter(lists);
	doc.descendants((node, pos) => {
		const name = node.type.name;
		if (name !== "blockContainer") return name === "doc" || name === "blockGroup";
		decorateBlock(node, pos, decos, legacy, lists, counter);
		return true;
	});
	return DecorationSet.create(doc, decos);
}

// The blocks an edit touched, as (position, node) in the new document; null when it reaches past single blocks (blocks added, removed,
// split or joined), or touches a list item, since list numbers after it may then change
function touchedBlocks(tr: Transaction): { pos: number; node: PMNode }[] | null {
	const found = new Map<number, PMNode>();
	const maps = tr.mapping.maps;
	for (let i = 0; i < maps.length; i++) {
		const rest = tr.mapping.slice(i + 1);
		let whole = false;
		maps[i].forEach((_oldStart, _oldEnd, newStart, newEnd) => {
			const from = rest.map(newStart, -1);
			const to = rest.map(newEnd, 1);
			const $from = tr.doc.resolve(Math.min(from, tr.doc.content.size));
			const $to = tr.doc.resolve(Math.min(to, tr.doc.content.size));
			// The innermost block around each end; both ends in the same one, or the edit is more than an edit inside a block
			const blockAt = ($p: typeof $from) => {
				for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === "blockContainer") return d;
				return 0;
			};
			const d = blockAt($from);
			if (!d || blockAt($to) !== d || $from.before(d) !== $to.before(d)) {
				whole = true;
				return;
			}
			const node = $from.node(d);
			// (a block holding blocks of its own is drawn again with them, by the whole pass)
			if (node.childCount > 1 || (node.firstChild && num(node.firstChild.attrs.numId, 0) > 0)) whole = true;
			found.set($from.before(d), node);
		});
		if (whole) return null;
	}
	return [...found].map(([pos, node]) => ({ pos, node }));
}

export const wordLayoutPlugin: Plugin<State> = new Plugin<State>({
	state: {
		init: () => ({ legacy: new Map(), lists: {}, set: DecorationSet.empty }),
		apply(tr, value) {
			const meta = tr.getMeta("wordLayout") as { legacy?: Map<string, ParaSpacing>; lists?: Record<string, ListLevel> } | undefined;
			if (meta) {
				const legacy = meta.legacy ? new Map([...value.legacy, ...meta.legacy]) : value.legacy;
				const lists = meta.lists ?? value.lists;
				return { legacy, lists, set: decorate(tr.doc, legacy, lists) };
			}
			if (!tr.docChanged) return value;
			// A file being filled in a piece at a time is drawn once, when it is all in (see `fillDone`)
			if (tr.getMeta("wordLayoutFill")) return { ...value, set: value.set.map(tr.mapping, tr.doc) };
			// Typing inside a block: only that block is drawn again. Anything more (blocks added, removed, split or joined, a list item
			// changed, a change from someone else or the shared undo) can renumber a list after it, so then the whole look is worked out
			// again (a walk over the blocks, not their text).
			const touched = tr.getMeta("y-sync$") ? null : touchedBlocks(tr);
			if (!touched) return { ...value, set: decorate(tr.doc, value.legacy, value.lists) };
			let set = value.set.map(tr.mapping, tr.doc);
			for (const { pos, node } of touched) {
				// (inside its edges, so the blocks either side keep theirs)
				set = set.remove(set.find(pos + 1, pos + node.nodeSize - 1));
				const decos: Decoration[] = [];
				decorateBlock(node, pos, decos, value.legacy, value.lists, null);
				set = set.add(tr.doc, decos);
			}
			return { ...value, set };
		},
	},
	props: {
		decorations: (state) => wordLayoutPlugin.getState(state)?.set ?? null,
		handleKeyDown: (view, event) => {
			if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
			const tr = listEnter(view.state.tr);
			if (!tr) return false;
			view.dispatch(tr.scrollIntoView());
			return true;
		},
	},
});

// Enter in an item of a Word list, as Word does it: the item is split and the new one stays in the list (the editor would make it a plain
// paragraph), or, in an empty item, the list ends there. Null when the selection is not in a Word list item.
export function listEnter(tr: Transaction): Transaction | null {
	const { $from, empty } = tr.selection;
	const content = $from.parent;
	const container = $from.depth >= 2 ? $from.node($from.depth - 1) : null;
	if (!empty || !container || container.type.name !== "blockContainer" || num(content.attrs.numId, 0) <= 0) return null;
	if (content.childCount === 0) return tr.setNodeMarkup($from.before(), undefined, { ...content.attrs, numId: 0, ilvl: 0, listLabel: "" });
	// The new item numbers itself (its label is worked out from the list) and does not repeat a break or section start of this one
	const attrs = { ...content.attrs, listLabel: "", pageBreakBefore: false, sectionVAlign: "" };
	return tr.split($from.pos, 2, [
		{ type: container.type, attrs: { ...container.attrs, id: undefined } },
		{ type: content.type, attrs },
	]);
}

// The old spacing map's entries (documents put in before blocks carried their properties)
export function setLegacySpacing(view: EditorView, added: Map<string, ParaSpacing>) {
	if (added.size) view.dispatch(view.state.tr.setMeta("wordLayout", { legacy: added }));
}

// The look of a document filled with "wordLayoutFill" transactions, worked out once they are all in
export function fillDone(view: EditorView) {
	view.dispatch(view.state.tr.setMeta("wordLayout", {}));
}

export function setListDefinitions(view: EditorView, lists: Record<string, ListLevel>) {
	// (the same definitions again would only draw every block again)
	if (JSON.stringify(wordLayoutPlugin.getState(view.state)?.lists ?? {}) === JSON.stringify(lists)) return;
	view.dispatch(view.state.tr.setMeta("wordLayout", { lists }));
}
