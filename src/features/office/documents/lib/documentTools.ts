// Small document operations that are plain data transformations: sorting a table, a table of contents, figure captions, and
// smart quotes as the person types.

import { Plugin } from "@tiptap/pm/state";

type Cell = { type?: string; content?: unknown; props?: unknown } | unknown;
interface Row {
	cells: Cell[];
}
export interface TableContent {
	type: "tableContent";
	rows: Row[];
	headerRows?: number;
}

const textOf = (cell: Cell): string => {
	const c = (cell as { content?: unknown } | null)?.content ?? cell;
	if (typeof c === "string") return c;
	return Array.isArray(c) ? c.map((x) => (typeof x === "string" ? x : ((x as { text?: string }).text ?? ""))).join("") : "";
};

// Rows below the header, ordered by one column: numbers as numbers, the rest as text (so 10 follows 9)
export function sortTable(table: TableContent, col: number, asc: boolean): TableContent {
	const head = table.headerRows ?? 0;
	const body = table.rows.slice(head);
	const key = (r: Row) => textOf(r.cells[col]).trim();
	const sorted = [...body].sort((a, b) => {
		const x = key(a);
		const y = key(b);
		const nx = Number(x.replace(/[,$%\s]/g, ""));
		const ny = Number(y.replace(/[,$%\s]/g, ""));
		const r = x !== "" && y !== "" && !Number.isNaN(nx) && !Number.isNaN(ny) ? nx - ny : x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
		return asc ? r : -r;
	});
	return { ...table, rows: [...table.rows.slice(0, head), ...sorted] };
}

// The marks that let a table of contents be found and made again
export const TOC = "toc";
export const TOC_TITLE = "toc-title";

// What typing one character turns the text before it into: (c) (r) (tm) become symbols, -- a dash, ... an ellipsis, -> an arrow
export function autoCorrect(before: string, ch: string): { remove: number; insert: string } | null {
	const rules: [string, string, string][] = [
		["(c", ")", "©"],
		["(r", ")", "®"],
		["(tm", ")", "™"],
		["-", "-", "—"],
		["..", ".", "…"],
		["-", ">", "→"],
	];
	for (const [tail, typed, out] of rules) if (ch === typed && before.endsWith(tail) && !(tail === "-" && typed === "-" && before.endsWith("--"))) return { remove: tail.length, insert: out };
	return null;
}

// Paragraphs for a table of contents, one per heading, indented by level
export function tocBlocks(headings: { level: number; text: string }[]): unknown[] {
	const title = { type: "heading", props: { level: 1, styleId: TOC_TITLE }, content: "Contents" };
	if (headings.length === 0) return [title, { type: "paragraph", props: { styleId: TOC }, content: "No headings yet. Use the Styles on the Home tab, then press Table of Contents again." }];
	return [title, ...headings.map((h) => ({ type: "paragraph", props: { styleId: TOC }, content: `${" ".repeat(h.level - 1)}${h.text}` }))];
}

// The next caption of a kind: "Figure 3: " when two paragraphs already begin "Figure 1" and "Figure 2"
export function nextCaption(texts: string[], label: string): string {
	const used = texts.filter((t) => new RegExp(`^${label} [0-9]+(?![0-9])`).test(t)).length;
	return `${label} ${used + 1}: `;
}

// Straight quotes become curly ones from what stands before them
export function smartQuote(ch: string, before: string): string | null {
	const opens = before === "" || /[\s(\[{\u2014\u2013\u2018\u201c-]$/.test(before);
	if (ch === '"') return opens ? "\u201c" : "\u201d";
	if (ch === "'") return opens ? "\u2018" : "\u2019";
	return null;
}

export const smartQuotesPlugin = new Plugin({
	props: {
		handleTextInput(view, from, to, text) {
			if (text.length !== 1) return false;
			const $from = view.state.doc.resolve(from);
			if ($from.parent.type.spec.code || $from.marks().some((m) => m.type.name === "code")) return false;
			const typed = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
			const fix = from === to ? autoCorrect(typed, text) : null;
			if (fix) {
				view.dispatch(view.state.tr.insertText(fix.insert, from - fix.remove, to));
				return true;
			}
			if (text !== '"' && text !== "'") return false;
			const q = smartQuote(text, $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc"));
			if (!q) return false;
			view.dispatch(view.state.tr.insertText(q, from, to));
			return true;
		},
	},
});

// The editor's HTML as the file writers read it: a block that starts a page gets `page-break-before`, and a picture, which the editor
// aligns with an attribute of its own, is put in a paragraph with that alignment
export function forFile(html: string): string {
	if (!html.includes("data-page-break-before") && !html.includes("<img")) return html;
	const d = new DOMParser().parseFromString(html, "text/html");
	d.body.querySelectorAll<HTMLElement>('[data-page-break-before="true"]').forEach((el) => (el.style.pageBreakBefore = "always"));
	d.body.querySelectorAll<HTMLElement>(":scope > img[data-text-alignment]").forEach((img) => {
		const align = img.getAttribute("data-text-alignment");
		if (!align || align === "left") return;
		const p = d.createElement("p");
		p.style.textAlign = align;
		img.replaceWith(p);
		p.append(img);
	});
	return d.body.innerHTML;
}
