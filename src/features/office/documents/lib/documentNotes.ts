// Footnotes and endnotes. A reference is one character of text with the style `note` (its value says whether it is a footnote or an endnote
// and which note); the page draws its number from a counter, so numbers follow the order of the text however the references are moved. The
// words of the notes are kept beside the text, shared. For the file the backend (`notes.rs`) takes a reference as the characters U+E002, the
// note's number, U+E003 in the text, and sends the notes of a file back the same way.

export interface NoteDef {
	end: boolean;
	text: string;
}

// What the backend takes for a note (`NoteIn`) and sends for one (`NoteOut`)
export interface NoteWire {
	id: number;
	end: boolean;
	text: string;
}

export const OPEN = "";
export const CLOSE = "";

// New notes are numbered from here up, so that they never meet the numbers of the notes a file already has
export const FIRST_NEW = 1_000_000;

export const noteValue = (end: boolean, id: number) => `${end ? "e" : "f"}${id}`;

export function parseNoteValue(value: string): { end: boolean; id: number } | null {
	const m = /^([fe])(\d{1,10})$/.exec(value);
	return m ? { end: m[1] === "e", id: Number(m[2]) } : null;
}

export const nextNoteId = (ids: Iterable<number>) => Math.max(FIRST_NEW, ...ids) + 1;

type Inline = { type?: string; text?: string; styles?: Record<string, unknown>; content?: unknown };
type Block = { content?: unknown; children?: unknown[] };

// The text of a reference: one character, which the page does not show (its number is drawn from a counter)
export const REF_TEXT = "*";

// The blocks of a file, its markers made into references. `end` says which of the file's notes are endnotes.
export function withReferences<T>(blocks: T[], notes: NoteWire[]): T[] {
	const end = new Map(notes.map((n) => [n.id, n.end]));
	const split = (item: Inline): Inline[] => {
		if (item.type !== "text" || !item.text || !item.text.includes(OPEN)) return [item];
		const out: Inline[] = [];
		const re = new RegExp(`${OPEN}(\\d{1,10})${CLOSE}`, "g");
		let at = 0;
		for (let m = re.exec(item.text); m; m = re.exec(item.text)) {
			if (m.index > at) out.push({ ...item, text: item.text.slice(at, m.index) });
			out.push({ type: "text", text: REF_TEXT, styles: { ...(item.styles ?? {}), note: noteValue(end.get(Number(m[1])) ?? false, Number(m[1])) } });
			at = m.index + m[0].length;
		}
		if (at < item.text.length) out.push({ ...item, text: item.text.slice(at) });
		return out;
	};
	const walk = (b: Block): Block => {
		let content = b.content;
		if (Array.isArray(content)) content = (content as Inline[]).flatMap(split);
		else if (content && typeof content === "object" && Array.isArray((content as { rows?: unknown[] }).rows)) {
			const t = content as { rows: { cells: unknown[] }[] };
			content = { ...t, rows: t.rows.map((r) => ({ ...r, cells: r.cells.map((c) => (Array.isArray(c) ? (c as Inline[]).flatMap(split) : c)) })) };
		}
		return { ...b, content, ...(b.children ? { children: (b.children as Block[]).map(walk) } : {}) };
	};
	return (blocks as unknown as Block[]).map(walk) as unknown as T[];
}

// The notes the text refers to, in the order of the text: [id, end]
export function referencesIn(blocks: Block[]): { id: number; end: boolean }[] {
	const found: { id: number; end: boolean }[] = [];
	const visit = (items: unknown) => {
		if (!Array.isArray(items)) return;
		for (const i of items as Inline[]) {
			const v = i.styles?.note;
			const p = typeof v === "string" ? parseNoteValue(v) : null;
			if (p && !found.some((f) => f.id === p.id)) found.push(p);
		}
	};
	const walk = (b: Block) => {
		const c = b.content as { rows?: { cells: unknown[] }[] } | unknown[] | undefined;
		if (Array.isArray(c)) visit(c);
		else c?.rows?.forEach((r) => r.cells.forEach((cell) => visit(Array.isArray(cell) ? cell : (cell as { content?: unknown })?.content)));
		(b.children as Block[] | undefined)?.forEach(walk);
	};
	blocks.forEach(walk);
	return found;
}

// The notes to send with the text: only the ones the text refers to
export const notesToSend = (blocks: Block[], defs: Map<number, NoteDef> | ReadonlyMap<number, NoteDef>): NoteWire[] =>
	referencesIn(blocks).flatMap((r) => {
		const d = defs.get(r.id);
		return d ? [{ id: r.id, end: r.end, text: d.text }] : [];
	});

// The editor's HTML as the backend reads it: a reference becomes its marker
export function markReferences(html: string): string {
	const d = new DOMParser().parseFromString(html, "text/html");
	d.body.querySelectorAll<HTMLElement>("[data-note]").forEach((el) => {
		const p = parseNoteValue(el.dataset.note ?? "");
		el.replaceWith(d.createTextNode(p ? `${OPEN}${p.id}${CLOSE}` : ""));
	});
	return d.body.innerHTML;
}
