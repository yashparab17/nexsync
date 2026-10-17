// Find and replace over the inline content of BlockNote blocks (text runs with styles, links, and the cells of tables)

export interface Run {
	type: "text";
	text: string;
	styles?: Record<string, unknown>;
}
export interface LinkRun {
	type: "link";
	href: string;
	content: Run[];
}
export type Inline = Run | LinkRun;

export interface Cell {
	type: "tableCell";
	content: Inline[];
	props?: Record<string, unknown>;
}
export interface TableContent {
	type: "tableContent";
	rows: { cells: (Inline[] | Cell)[] }[];
}

export interface BlockLike {
	id: string;
	type: string;
	content?: Inline[] | TableContent | undefined;
	children?: BlockLike[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = (find: string, cs: boolean, whole = false) => (whole ? new RegExp(String.raw`(?<![\p{L}\p{N}'])${escape(find)}(?![\p{L}\p{N}'])`, cs ? "gu" : "giu") : new RegExp(escape(find), cs ? "g" : "gi"));

function runsOf(content: Inline[], re: RegExp, repl: string | null): { content: Inline[]; count: number } {
	let count = 0;
	const out = content.map((c): Inline => {
		if (c.type === "link") {
			const inner = runsOf(c.content, re, repl);
			count += inner.count;
			return repl === null ? c : { ...c, content: inner.content as Run[] };
		}
		const hits = c.text.match(re)?.length ?? 0;
		count += hits;
		return repl !== null && hits > 0 ? { ...c, text: c.text.replace(re, () => repl) } : c;
	});
	return { content: out, count };
}

function cellContent(c: Inline[] | Cell): Inline[] {
	return Array.isArray(c) ? c : c.content;
}

// The blocks with every match replaced (when `repl` is a string) and how many there were; blocks without a match are left out of
// `changed`, so only those are written back to the editor
export function replaceInBlocks(blocks: BlockLike[], find: string, repl: string | null, caseSensitive: boolean, wholeWord = false): { changed: { id: string; content: Inline[] | TableContent }[]; count: number } {
	if (!find) return { changed: [], count: 0 };
	const changed: { id: string; content: Inline[] | TableContent }[] = [];
	let count = 0;
	const walk = (list: BlockLike[]) => {
		for (const b of list) {
			const re = pattern(find, caseSensitive, wholeWord);
			if (Array.isArray(b.content)) {
				const r = runsOf(b.content, re, repl);
				count += r.count;
				if (r.count > 0 && repl !== null) changed.push({ id: b.id, content: r.content });
			} else if (b.content && b.content.type === "tableContent") {
				let here = 0;
				const rows = b.content.rows.map((row) => ({
					cells: row.cells.map((cell) => {
						const r = runsOf(cellContent(cell), re, repl);
						here += r.count;
						return Array.isArray(cell) ? r.content : { ...cell, content: r.content };
					}),
				}));
				count += here;
				if (here > 0 && repl !== null) changed.push({ id: b.id, content: { type: "tableContent", rows } });
			}
			if (b.children?.length) walk(b.children);
		}
	};
	walk(blocks);
	return { changed, count };
}

// The text of every block, for counting words
export function textOfBlocks(blocks: BlockLike[]): string {
	const lines: string[] = [];
	const text = (c: Inline[]): string => c.map((r) => (r.type === "link" ? text(r.content) : r.text)).join("");
	const walk = (list: BlockLike[]) => {
		for (const b of list) {
			if (Array.isArray(b.content)) lines.push(text(b.content));
			else if (b.content?.type === "tableContent") for (const row of b.content.rows) lines.push(row.cells.map((c) => text(cellContent(c))).join("\t"));
			if (b.children?.length) walk(b.children);
		}
	};
	walk(blocks);
	return lines.join("\n");
}

// The headings, in order, for the Navigation pane
export function headingsOf(blocks: BlockLike[]): { id: string; level: number; text: string }[] {
	const out: { id: string; level: number; text: string }[] = [];
	const walk = (list: (BlockLike & { props?: { level?: number } })[]) => {
		for (const b of list) {
			if (b.type === "heading" && Array.isArray(b.content)) out.push({ id: b.id, level: b.props?.level ?? 1, text: textOfBlocks([{ ...b, children: [] }]).trim() || "(empty heading)" });
			if (b.children?.length) walk(b.children);
		}
	};
	walk(blocks);
	return out;
}
