// The pure side of the Documents ribbon: fonts and sizes, paper sizes and margins, the page a document sits on, and counting.

export const FONTS = [
	{ name: "Calibri", stack: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif" },
	{ name: "Arial", stack: "Arial, Helvetica, sans-serif" },
	{ name: "Times New Roman", stack: "'Times New Roman', Times, serif" },
	{ name: "Georgia", stack: "Georgia, serif" },
	{ name: "Cambria", stack: "Cambria, Caladea, Georgia, serif" },
	{ name: "Verdana", stack: "Verdana, Geneva, sans-serif" },
	{ name: "Trebuchet MS", stack: "'Trebuchet MS', sans-serif" },
	{ name: "Segoe UI", stack: "'Segoe UI', system-ui, sans-serif" },
	{ name: "Consolas", stack: "Consolas, 'Courier New', monospace" },
	{ name: "Courier New", stack: "'Courier New', Courier, monospace" },
] as const;

export const DEFAULT_FONT = "Calibri";
export const DEFAULT_SIZE = 11;
export const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

export const fontStack = (name: string) => FONTS.find((f) => f.name === name)?.stack ?? `'${name}', sans-serif`;

// "14pt" or "14" as a number of points, or null
export function pointsOf(value: string | undefined | null): number | null {
	const m = /^(\d+(?:\.\d+)?)\s*(pt)?$/.exec((value ?? "").trim());
	return m ? Number(m[1]) : null;
}

// The next size up or down the list from `current`, and the same for Grow and Shrink font buttons
export function stepSize(current: number, dir: 1 | -1): number {
	if (dir === 1) return SIZES.find((s) => s > current) ?? Math.min(current + 10, 400);
	return [...SIZES].reverse().find((s) => s < current) ?? Math.max(current - 1, 1);
}

export const PAPER = {
	letter: { label: "Letter", note: '8.5" × 11"', w: 612, h: 792 },
	legal: { label: "Legal", note: '8.5" × 14"', w: 612, h: 1008 },
	a4: { label: "A4", note: "21 × 29.7 cm", w: 595.3, h: 841.9 },
	a5: { label: "A5", note: "14.8 × 21 cm", w: 419.5, h: 595.3 },
	a3: { label: "A3", note: "29.7 × 42 cm", w: 841.9, h: 1190.6 },
} as const;
export type PaperName = keyof typeof PAPER;

export const MARGINS = {
	normal: { label: "Normal", note: "Top, bottom, left, right: 1\"", top: 72, bottom: 72, left: 72, right: 72 },
	narrow: { label: "Narrow", note: 'All sides: 0.5"', top: 36, bottom: 36, left: 36, right: 36 },
	moderate: { label: "Moderate", note: 'Top and bottom 1", sides 0.75"', top: 72, bottom: 72, left: 54, right: 54 },
	wide: { label: "Wide", note: 'Top and bottom 1", sides 2"', top: 72, bottom: 72, left: 144, right: 144 },
} as const;
export type MarginName = keyof typeof MARGINS;

export interface PageSetup {
	paper: PaperName;
	landscape: boolean;
	margins: MarginName;
	columns: 1 | 2 | 3;
	// Line spacing as a multiple of the text size, shown in the editor
	spacing: number;
	// Where the text sits between the top and bottom margins of a page
	valign: "top" | "center" | "bottom" | "justify";
	// The page as a file has it, when that is not one of the paper sizes and margins above (points); the paper and margins win once chosen
	custom?: PageBox;
	// Text drawn across each page in the editor (not written to the file)
	watermark?: string;
	// A number beside each line of text in the editor (not written to the file)
	lineNumbers?: boolean;
	// Editor-only looks: break words at line ends, a border inside each page, shaded alternate table rows
	hyphenate?: boolean;
	border?: boolean;
	banded?: boolean;
	dropCap?: boolean;
}

export const DEFAULT_PAGE: PageSetup = { paper: "letter", landscape: false, margins: "normal", columns: 1, spacing: 1.15, valign: "top" };

export interface PageBox {
	width: number;
	height: number;
	top: number;
	right: number;
	bottom: number;
	left: number;
}

// The page in points, turned on its side when it is landscape
export function pageBox(setup: PageSetup): PageBox {
	if (setup.custom) return setup.custom;
	const p = PAPER[setup.paper] ?? PAPER.letter;
	const m = MARGINS[setup.margins] ?? MARGINS.normal;
	return { width: setup.landscape ? p.h : p.w, height: setup.landscape ? p.w : p.h, top: m.top, right: m.right, bottom: m.bottom, left: m.left };
}

const validBox = (b: unknown): b is PageBox => {
	if (!b || typeof b !== "object") return false;
	const x = b as Record<string, unknown>;
	return ["width", "height", "top", "right", "bottom", "left"].every((k) => typeof x[k] === "number" && Number.isFinite(x[k]) && (x[k] as number) >= 0 && (x[k] as number) <= 2000) && (x.width as number) >= 72 && (x.height as number) >= 72;
};

// The page set-up and header settings a file starts with, from what the backend read in it
export function setupFromLayout(l: { width: number; height: number; landscape: boolean; top: number; right: number; bottom: number; left: number; columns: number; header: string; footer: string; pageNumbers: boolean; valign?: string; firstHeader?: string; firstFooter?: string; evenHeader?: string; evenFooter?: string }): { page: PageSetup; hf: HeaderFooter } {
	const page = readPage({ landscape: l.landscape, columns: l.columns, valign: l.valign, custom: { width: l.width, height: l.height, top: l.top, right: l.right, bottom: l.bottom, left: l.left } });
	return { page, hf: readHeaderFooter({ header: l.header, footer: l.footer, pageNumbers: l.pageNumbers, firstHeader: l.firstHeader, firstFooter: l.firstFooter, evenHeader: l.evenHeader, evenFooter: l.evenFooter }) };
}

// Reads a stored setup, keeping what is valid and the default for the rest
export function readPage(raw: unknown): PageSetup {
	const r = (raw && typeof raw === "object" ? raw : {}) as Partial<PageSetup>;
	return {
		paper: r.paper && r.paper in PAPER ? r.paper : DEFAULT_PAGE.paper,
		landscape: r.landscape === true,
		margins: r.margins && r.margins in MARGINS ? r.margins : DEFAULT_PAGE.margins,
		columns: r.columns === 2 || r.columns === 3 ? r.columns : 1,
		spacing: typeof r.spacing === "number" && r.spacing >= 1 && r.spacing <= 3 ? r.spacing : DEFAULT_PAGE.spacing,
		valign: r.valign === "center" || r.valign === "bottom" || r.valign === "justify" ? r.valign : "top",
		...(validBox(r.custom) ? { custom: r.custom } : {}),
		...(r.lineNumbers === true ? { lineNumbers: true } : {}),
		...(r.hyphenate === true ? { hyphenate: true } : {}),
		...(r.border === true ? { border: true } : {}),
		...(r.banded === true ? { banded: true } : {}),
		...(r.dropCap === true ? { dropCap: true } : {}),
		...(typeof r.watermark === "string" && r.watermark.trim() ? { watermark: r.watermark.trim().slice(0, 40) } : {}),
	};
}

export interface HeaderFooter {
	header: string;
	footer: string;
	// "Page {n}" style numbering in the footer
	pageNumbers: boolean;
	// What the first page, and the even pages, have instead (empty: the same as the others)
	firstHeader?: string;
	firstFooter?: string;
	evenHeader?: string;
	evenFooter?: string;
}

export const NO_HEADER: HeaderFooter = { header: "", footer: "", pageNumbers: false, firstHeader: "", firstFooter: "", evenHeader: "", evenFooter: "" };

// The header or footer text a page shows: the first page's own, an even page's own, or the ordinary one
export function textFor(hf: HeaderFooter, part: "header" | "footer", pageIndex: number): string {
	const first = part === "header" ? hf.firstHeader : hf.firstFooter;
	const even = part === "header" ? hf.evenHeader : hf.evenFooter;
	if (pageIndex === 0 && first) return first;
	if (pageIndex % 2 === 1 && even) return even;
	return hf[part];
}

export function readHeaderFooter(raw: unknown): HeaderFooter {
	const r = (raw && typeof raw === "object" ? raw : {}) as Partial<HeaderFooter>;
	const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");
	const extra = Object.fromEntries((["firstHeader", "firstFooter", "evenHeader", "evenFooter"] as const).map((k) => [k, text(r[k])]).filter(([, v]) => v));
	return { header: text(r.header), footer: text(r.footer), pageNumbers: r.pageNumbers === true, ...extra };
}

export const PX_PER_PT = 96 / 72;

// How many pages a body of this height (in pixels at 100%) fills
export function pageCount(contentHeightPx: number, box: PageBox): number {
	const room = (box.height - box.top - box.bottom) * PX_PER_PT;
	return Math.max(1, Math.ceil(contentHeightPx / Math.max(room, 1)));
}

export interface Counts {
	words: number;
	characters: number;
	charactersNoSpaces: number;
	paragraphs: number;
}

export function countText(text: string): Counts {
	const t = text.replace(/\r\n?/g, "\n");
	const words = t.trim() === "" ? 0 : t.trim().split(/\s+/).length;
	return { words, characters: t.replace(/\n/g, "").length, charactersNoSpaces: t.replace(/\s/g, "").length, paragraphs: t.split("\n").filter((l) => l.trim() !== "").length };
}

// The named looks of the Styles gallery, as the block each becomes
export const STYLES = [
	{ id: "normal", label: "Normal", block: { type: "paragraph" } },
	{ id: "h1", label: "Heading 1", block: { type: "heading", props: { level: 1 } } },
	{ id: "h2", label: "Heading 2", block: { type: "heading", props: { level: 2 } } },
	{ id: "h3", label: "Heading 3", block: { type: "heading", props: { level: 3 } } },
	{ id: "quote", label: "Quote", block: { type: "quote" } },
	{ id: "code", label: "Code", block: { type: "codeBlock" } },
] as const;

export type StyleId = (typeof STYLES)[number]["id"];

// The gallery entry that matches a block
export function styleOf(block: { type: string; props?: { level?: number } } | undefined): StyleId {
	if (!block) return "normal";
	if (block.type === "heading") return block.props?.level === 2 ? "h2" : block.props?.level === 3 ? "h3" : "h1";
	if (block.type === "quote") return "quote";
	if (block.type === "codeBlock") return "code";
	return "normal";
}

export const PALETTE = ["000000", "404040", "7F7F7F", "C00000", "FF0000", "FFC000", "FFFF00", "92D050", "00B050", "00B0F0", "0070C0", "002060", "7030A0", "FFFFFF"];

export const HIGHLIGHTS = ["FFFF00", "92D050", "00FFFF", "FF00FF", "FFC000", "D9D9D9"];

export type CaseKind = "upper" | "lower" | "title" | "sentence";

// Text in another case: Title Case capitalises each word, Sentence case the first letter after a full stop, question or exclamation mark
export function changeCase(text: string, kind: CaseKind): string {
	if (kind === "upper") return text.toUpperCase();
	const lower = text.toLowerCase();
	if (kind === "lower") return lower;
	if (kind === "title") return lower.replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
	return lower.replace(/(^|[.!?]\s+)(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
}
