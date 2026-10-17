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
}

export const DEFAULT_PAGE: PageSetup = { paper: "letter", landscape: false, margins: "normal", columns: 1, spacing: 1.15 };

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
	const p = PAPER[setup.paper] ?? PAPER.letter;
	const m = MARGINS[setup.margins] ?? MARGINS.normal;
	return { width: setup.landscape ? p.h : p.w, height: setup.landscape ? p.w : p.h, top: m.top, right: m.right, bottom: m.bottom, left: m.left };
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
	};
}

export interface HeaderFooter {
	header: string;
	footer: string;
	// "Page {n}" style numbering in the footer
	pageNumbers: boolean;
}

export const NO_HEADER: HeaderFooter = { header: "", footer: "", pageNumbers: false };

export function readHeaderFooter(raw: unknown): HeaderFooter {
	const r = (raw && typeof raw === "object" ? raw : {}) as Partial<HeaderFooter>;
	return { header: typeof r.header === "string" ? r.header.slice(0, 200) : "", footer: typeof r.footer === "string" ? r.footer.slice(0, 200) : "", pageNumbers: r.pageNumbers === true };
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
