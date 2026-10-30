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
): StyleDef {
	const num = (v: unknown, none: number) => (typeof v === "number" && v !== none ? v : none);
	const align = (ALIGNS as readonly string[]).includes(String(block.textAlignment)) ? (block.textAlignment as StyleDef["align"]) : "left";
	return {
		id,
		name: name.trim() || id,
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

// The styles to send with the text: the ones made or changed here
export const editedStyles = (all: Iterable<StyleDef>): StyleIn[] => [...all].filter((d) => d.edited).map(toStyleIn);

// The styles the gallery offers beside the built-in ones, by name
export const galleryStyles = (all: Iterable<StyleDef>): StyleDef[] => [...all].filter((d) => !isBuiltInWordId(d.id)).sort((a, b) => a.name.localeCompare(b.name));
