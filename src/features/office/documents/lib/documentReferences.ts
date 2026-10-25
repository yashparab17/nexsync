// Document operations that are plain data transformations, part two (see documentTools.ts): table formulas, equations, sources and
// citations, an index, and mail merge.

type Cell = unknown;
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

// ── table formulas ──

export type Formula = "sumAbove" | "sumLeft" | "avgAbove" | "avgLeft";

const numberIn = (cell: Cell): number | null => {
	const n = Number(textOf(cell).replace(/[,$%\s]/g, ""));
	return textOf(cell).trim() !== "" && Number.isFinite(n) ? n : null;
};

// The table with the cell at (row, col) holding the sum or average of the numbers above it (reading upwards to the first cell that
// is not one) or to its left, as Word's =SUM(ABOVE) does; null when there are no numbers
export function withFormula(table: TableContent, row: number, col: number, kind: Formula): TableContent | null {
	const cells: Cell[] = kind.endsWith("Above")
		? table.rows
				.slice(0, row)
				.map((r) => r.cells[col])
				.reverse()
		: table.rows[row].cells.slice(0, col).reverse();
	const nums: number[] = [];
	for (const c of cells) {
		const n = numberIn(c);
		if (n === null) break;
		nums.push(n);
	}
	if (nums.length === 0) return null;
	const total = nums.reduce((a, b) => a + b, 0);
	const text = String(Math.round((kind.startsWith("sum") ? total : total / nums.length) * 100) / 100);
	const run = [{ type: "text", text, styles: {} }];
	const put = (c: Cell) => (c && typeof c === "object" && !Array.isArray(c) && "content" in (c as object) ? { ...(c as object), content: run } : run);
	return { ...table, rows: table.rows.map((r, i) => (i !== row ? r : { ...r, cells: r.cells.map((c, j) => (j !== col ? c : put(c))) })) };
}

// ── equations ──

const SYMBOLS: Record<string, string> = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", theta: "θ", lambda: "λ", mu: "μ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ", Omega: "Ω", Pi: "Π", infty: "∞", pm: "±", times: "×", div: "÷", leq: "≤", geq: "≥", neq: "≠", approx: "≈", sum: "∑", int: "∫", partial: "∂", cdot: "·", to: "→", sqrt: "√" };
const SUP_FROM = "0123456789+-=()ni";
const SUP_TO = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ";
const SUB_FROM = "0123456789+-=()";
const SUB_TO = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎";
const shift = (s: string, from: string, to: string) => [...s].map((c) => (from.includes(c) ? [...to][from.indexOf(c)] : c)).join("");

// A linear or LaTeX-style formula as plain text with Unicode symbols: \alpha, x^2, a_1, \frac{a}{b}, \sqrt{x}
export function equationText(src: string): string {
	return src
		.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)⁄($2)")
		.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
		.replace(/\\([A-Za-z]+)/g, (m, w: string) => SYMBOLS[w] ?? m)
		.replace(/\^\{([^{}]*)\}|\^(\w)/g, (_m, a?: string, b?: string) => shift(a ?? b ?? "", SUP_FROM, SUP_TO))
		.replace(/_\{([^{}]*)\}|_(\w)/g, (_m, a?: string, b?: string) => shift(a ?? b ?? "", SUB_FROM, SUB_TO))
		.replace(/[{}]/g, "");
}

// ── sources and citations ──

export interface Source {
	id: string;
	author: string;
	year: string;
	title: string;
	publisher: string;
}
export type CitationStyle = "APA" | "MLA" | "Chicago" | "IEEE";

const surname = (a: string) => (a.includes(",") ? a.split(",")[0] : (a.trim().split(/\s+/).pop() ?? a)).trim();

// The mark in the text: (Smith, 2020), (Smith), (Smith 2020) or [2]
export function citation(s: Source, style: CitationStyle, n: number): string {
	const a = surname(s.author);
	return style === "APA" ? `(${a}, ${s.year})` : style === "MLA" ? `(${a})` : style === "Chicago" ? `(${a} ${s.year})` : `[${n}]`;
}

// The reference list: by author for APA, MLA and Chicago, as they were added for IEEE
export function bibliography(sources: Source[], style: CitationStyle): string[] {
	const list = style === "IEEE" ? sources : [...sources].sort((a, b) => a.author.localeCompare(b.author));
	return list.map((s, i) => {
		if (style === "APA") return `${s.author} (${s.year}). ${s.title}.${s.publisher ? ` ${s.publisher}.` : ""}`;
		if (style === "IEEE") return `[${i + 1}] ${s.author}, "${s.title},"${s.publisher ? ` ${s.publisher},` : ""} ${s.year}.`;
		return `${s.author}. ${s.title}.${s.publisher ? ` ${s.publisher},` : ""} ${s.year}.`;
	});
}

// ── index ──

// The words the writer marked (highlighted), in alphabetical order
export function indexEntries(blocks: { content?: unknown; children?: unknown[] }[]): string[] {
	const seen = new Set<string>();
	const walk = (list: { content?: unknown; children?: unknown[] }[]) => {
		for (const b of list) {
			if (Array.isArray(b.content)) for (const r of b.content as { text?: string; styles?: Record<string, unknown> }[]) if (r.styles?.backgroundColor && r.text?.trim()) seen.add(r.text.trim());
			if (Array.isArray(b.children)) walk(b.children as never);
		}
	};
	walk(blocks);
	return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

// ── mail merge ──

// Rows from comma-separated text with a header line; "quoted, fields" and "" inside quotes are understood
export function parseCsv(text: string): Record<string, string>[] {
	// A list of objects (JSON) is taken as it is
	if (text.trimStart().startsWith("[")) {
		try {
			const list = JSON.parse(text) as unknown;
			if (Array.isArray(list)) return list.filter((r) => r && typeof r === "object").map((r) => Object.fromEntries(Object.entries(r as object).map(([k, v]) => [k, String(v ?? "")])));
		} catch {
			return [];
		}
	}
	// Cells copied from a Sheet or a spreadsheet are separated by tabs
	const sep = text.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";
	const rows: string[][] = [];
	let row: string[] = [];
	let cur = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (c === '"') quoted = false;
			else cur += c;
		} else if (c === '"') quoted = true;
		else if (c === sep) {
			row.push(cur);
			cur = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			row.push(cur);
			rows.push(row);
			row = [];
			cur = "";
		} else cur += c;
	}
	if (cur !== "" || row.length) {
		row.push(cur);
		rows.push(row);
	}
	const [head, ...rest] = rows.filter((r) => r.some((c) => c.trim() !== ""));
	return head ? rest.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()]))) : [];
}

const fill = (s: string, row: Record<string, string>) => s.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k: string) => row[k] ?? m);

type Blk = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: Blk[] };
const merged = (b: Blk, row: Record<string, string>): Blk => {
	const { id: _id, ...rest } = b;
	const content =
		typeof b.content === "string"
			? fill(b.content, row)
			: Array.isArray(b.content)
				? b.content.map((r: { type?: string; text?: string } | string) => (typeof r === "string" ? fill(r, row) : r.type === "text" && r.text ? { ...r, text: fill(r.text, row) } : r))
				: b.content && typeof b.content === "object"
					? JSON.parse(fill(JSON.stringify(b.content), Object.fromEntries(Object.entries(row).map(([k, v]) => [k, JSON.stringify(v).slice(1, -1)]))))
					: b.content;
	return { ...rest, content, children: b.children?.map((c) => merged(c, row)) };
};

// One copy of the blocks per row with {{field}} filled in; every copy after the first starts on a new page
export function mailMerge(blocks: Blk[], rows: Record<string, string>[]): Blk[] {
	return rows.flatMap((row, i) => {
		const copy = blocks.map((b) => merged(b, row));
		if (i > 0 && copy[0]) copy[0] = { ...copy[0], props: { ...copy[0].props, pageBreakBefore: true } };
		return copy;
	});
}
