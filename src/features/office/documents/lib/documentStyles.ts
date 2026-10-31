// Named paragraph styles in the editor. A file's own styles (Title, Caption, a company's Callout) come into the document's shared style list
// when the file is opened; the Styles gallery offers them beside the six built-in looks; a style made or changed here is sent with the text on
// save and written into the file's styles (see `styles.rs` on the backend). Applying a style sets its id on the paragraph and puts its look on
// the text, the way the editor holds every look: as formatting on the runs.

import type { StyleId } from "@/features/office/documents/lib/documentFormat";

// A style as the editor holds it, and as it is written into the document's shared list
export interface StyleDef {
	id: string;
	name: string;
	basedOn?: string;
	font: string;
	// Points
	size: number;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	// #rrggbb, or empty for the text colour the page gives
	color: string;
	align: "left" | "center" | "right" | "justify";
	spaceBefore: number;
	spaceAfter: number;
	// A multiple of single spacing, or (below zero) exactly that many points
	lineSpacing: number;
	// Made or changed in this editor, so it goes into the file on save
	edited?: boolean;
	// A style of paragraphs (the default), of letters, or of tables
	kind?: StyleKind;
	// What a table style gives
	table?: TableLook;
}

export type StyleKind = "paragraph" | "character" | "table";

// The fills of a table style: the header row (and its text), every second row, and every cell; #rrggbb or empty for none
export interface TableLook {
	headerFill: string;
	headerColor: string;
	headerBold: boolean;
	bandFill: string;
	fill: string;
}

// What the backend sends for a style of the file (`StyleOut`)
export interface StyleOut {
	id: string;
	name: string;
	basedOn?: string | null;
	font: string;
	size: number;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	color: string;
	align: string;
	spaceBefore: number;
	spaceAfter: number;
	lineSpacing: number;
	outline: number;
	used: boolean;
	kind?: StyleKind;
	table?: TableLook | null;
}

// What the backend takes for a style to write into the file (`StyleIn`)
export interface StyleIn {
	id: string;
	name: string;
	basedOn: string;
	font: string;
	size: number;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	color: string;
	align: string;
	spaceBefore: number;
	spaceAfter: number;
	lineSpacing: number;
	kind: "" | "character" | "table";
	table: TableLook | null;
}

const ALIGNS = ["left", "center", "right", "justify"] as const;

export function fromFile(o: StyleOut): StyleDef {
	return {
		id: o.id,
		name: o.name,
		basedOn: o.basedOn ?? undefined,
		font: o.font,
		size: o.size,
		bold: o.bold,
		italic: o.italic,
		underline: o.underline,
		color: o.color,
		align: (ALIGNS as readonly string[]).includes(o.align) ? (o.align as StyleDef["align"]) : "left",
		spaceBefore: o.spaceBefore,
		spaceAfter: o.spaceAfter,
		lineSpacing: o.lineSpacing,
		...(o.kind && o.kind !== "paragraph" ? { kind: o.kind } : {}),
		...(o.table ? { table: o.table } : {}),
	};
}

export const toStyleIn = (d: StyleDef): StyleIn => ({
	id: d.id,
	name: d.name,
	basedOn: d.basedOn ?? "",
	font: d.font,
	size: d.size,
	bold: d.bold,
	italic: d.italic,
	underline: d.underline,
	color: d.color,
	align: d.align,
	spaceBefore: d.spaceBefore,
	spaceAfter: d.spaceAfter,
	lineSpacing: d.lineSpacing,
	kind: d.kind === "character" || d.kind === "table" ? d.kind : "",
	table: d.table ?? null,
});

// The Word style each built-in look of the gallery is, so that the paragraph says so (the file's Heading 2 is "Heading2"); the plain looks say nothing
export const WORD_ID: Record<StyleId, string> = { normal: "", h1: "Heading1", h2: "Heading2", h3: "Heading3", quote: "Quote", code: "" };

const WORD_IDS = new Set(Object.values(WORD_ID).filter(Boolean));

// The ids of the file's own looks of the built-in gallery entries: kept in the list so they are written, but not offered a second time
export const isBuiltInWordId = (id: string) => WORD_IDS.has(id);

// An id for a style by its name: letters and digits only, and not one that is taken
export function idFromName(name: string, taken: Iterable<string>): string {
	const used = new Set([...taken].map((t) => t.toLowerCase()));
	const base = name.normalize("NFKD").replace(/[^A-Za-z0-9]/g, "").slice(0, 40) || "Style";
	const first = /^[0-9]/.test(base) ? `S${base}` : base;
	let id = first;
	for (let n = 2; used.has(id.toLowerCase()); n++) id = `${first}${n}`;
	return id;
}

// The look as formatting on runs: a false (bold off) removes the style, a colour of none leaves the page's colour
export function applyToRuns(styles: Record<string, unknown>, d: StyleDef): Record<string, unknown> {
	const next = { ...styles, fontFamily: d.font, fontSize: `${d.size}pt` } as Record<string, unknown>;
	for (const [key, on] of [["bold", d.bold], ["italic", d.italic], ["underline", d.underline]] as const) {
		if (on) next[key] = true;
		else delete next[key];
	}
	if (d.color) next.textColor = d.color;
	else delete next.textColor;
	return next;
}

// The paragraph's own properties a style sets (the editor's names, points), and the id that says which style it is
export const blockPropsOf = (d: StyleDef): Record<string, unknown> => ({ styleId: d.id, textAlignment: d.align, spaceBefore: d.spaceBefore, spaceAfter: d.spaceAfter, lineSpacing: d.lineSpacing });

// A style made from the look at the caret: the formatting of the text there and the paragraph's own properties
export function fromCaret(
	name: string,
	id: string,
	look: { font: string; size: number; bold: boolean; italic: boolean; underline: boolean; color: string },
	block: { textAlignment?: unknown; spaceBefore?: unknown; spaceAfter?: unknown; lineSpacing?: unknown },
	basedOn?: string,
): StyleDef {
	const num = (v: unknown, none: number) => (typeof v === "number" && v !== none ? v : none);
	const align = (ALIGNS as readonly string[]).includes(String(block.textAlignment)) ? (block.textAlignment as StyleDef["align"]) : "left";
	return {
		id,
		name: name.trim() || id,
		...(basedOn ? { basedOn } : {}),
		font: look.font,
		size: look.size,
		bold: look.bold,
		italic: look.italic,
		underline: look.underline,
		color: look.color,
		align,
		// The editor keeps -1 for "not set" and 0 for single spacing not set; a style says what it gives, so those become the usual values
		spaceBefore: Math.max(0, num(block.spaceBefore, -1)),
		spaceAfter: Math.max(0, num(block.spaceAfter, -1)),
		lineSpacing: num(block.lineSpacing, 0) || 1,
		edited: true,
	};
}

const LOOK_FIELDS = ["font", "size", "bold", "italic", "underline", "color", "align", "spaceBefore", "spaceAfter", "lineSpacing"] as const;

// The styles that follow a style that was changed: one based on it (at any depth) takes the new value of each field it still had the old
// value of, and keeps the fields it set itself. Returned changed, and marked as such so that they go to the file.
export function inherit(all: StyleDef[], before: StyleDef, after: StyleDef): StyleDef[] {
	const out: StyleDef[] = [];
	const queue = [{ old: before, now: after }];
	for (let guard = 0; queue.length && guard < 200; guard++) {
		const { old, now } = queue.shift()!;
		for (const d of all.filter((x) => x.basedOn === old.id && x.id !== old.id)) {
			const next: StyleDef = { ...d, edited: true };
			let moved = false;
			for (const f of LOOK_FIELDS) {
				if (old[f] !== now[f] && d[f] === old[f]) {
					(next as unknown as Record<string, unknown>)[f] = now[f];
					moved = true;
				}
			}
			if (moved && !out.some((o) => o.id === d.id)) {
				out.push(next);
				queue.push({ old: d, now: next });
			}
		}
	}
	return out;
}

// The styles to send with the text: the ones made or changed here
export const editedStyles = (all: Iterable<StyleDef>): StyleIn[] => [...all].filter((d) => d.edited).map(toStyleIn);

// The styles the gallery offers beside the built-in ones, by name
const byName = (a: StyleDef, b: StyleDef) => a.name.localeCompare(b.name);
const kindOf = (d: StyleDef): StyleKind => d.kind ?? "paragraph";
export const galleryStyles = (all: Iterable<StyleDef>): StyleDef[] => [...all].filter((d) => kindOf(d) === "paragraph" && !isBuiltInWordId(d.id)).sort(byName);
// The styles of letters, which go on the selected words
export const characterStyles = (all: Iterable<StyleDef>): StyleDef[] => [...all].filter((d) => kindOf(d) === "character").sort(byName);
// The styles of tables
export const tableStyles = (all: Iterable<StyleDef>): StyleDef[] => [...all].filter((d) => kindOf(d) === "table").sort(byName);

// A style of letters made from the look of the selected words
export function characterFrom(name: string, id: string, look: { font: string; size: number; bold: boolean; italic: boolean; underline: boolean; color: string }): StyleDef {
	return { id, name: name.trim() || id, kind: "character", ...look, align: "left", spaceBefore: 0, spaceAfter: 0, lineSpacing: 1, edited: true };
}

// A style of tables from the fills chosen for it
export function tableFrom(name: string, id: string, table: TableLook): StyleDef {
	return { id, name: name.trim() || id, kind: "table", table, font: "", size: 0, bold: false, italic: false, underline: false, color: "", align: "left", spaceBefore: 0, spaceAfter: 0, lineSpacing: 1, edited: true };
}

// The marks that put a character style's look on words: its id, and each part of the look (a look that is off takes the mark away)
export function charMarks(d: StyleDef): { on: Record<string, unknown>; off: string[] } {
	const on: Record<string, unknown> = { charStyle: d.id };
	const off: string[] = [];
	if (d.font) on.fontFamily = d.font;
	if (d.size > 0) on.fontSize = `${d.size}pt`;
	for (const k of ["bold", "italic", "underline"] as const) (d[k] ? (on[k] = true) : off.push(k));
	if (d.color) on.textColor = d.color;
	return { on, off };
}

// CSS that draws the table styles the document has on the tables that use them: the header row, the odd rows, every cell
export function tableStyleCss(all: Iterable<StyleDef>, escape: (id: string) => string = (id) => id.replace(/[^A-Za-z0-9_-]/g, (c) => `\\${c}`)): string {
	const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "");
	return tableStyles(all)
		.map((d) => {
			const t = d.table;
			if (!t) return "";
			const base = `.bn-block-content[data-content-type="table"]:has([data-table-style="${escape(d.id)}"])`;
			const rules: string[] = [];
			if (hex(t.fill)) rules.push(`${base} :is(td,th){background-color:${t.fill}}`);
			if (hex(t.bandFill)) rules.push(`${base} tr:nth-child(even) :is(td,th){background-color:${t.bandFill}}`);
			if (hex(t.headerFill) || t.headerBold || hex(t.headerColor)) rules.push(`${base} tr:first-child :is(td,th){${hex(t.headerFill) ? `background-color:${t.headerFill};` : ""}${t.headerBold ? "font-weight:700;" : ""}${hex(t.headerColor) ? `color:${t.headerColor};` : ""}}`);
			return rules.join("\n");
		})
		.filter(Boolean)
		.join("\n");
}
