// Sections: a paragraph that starts one carries its page set-up in the block property `sectionBreak`, as `kind|orientation|top,right,bottom,left|columns`
// (next or cont(inuous), p(ortrait) or l(andscape), the margins in points or empty for "as the section had them", one to three columns).
// The backend (`sections.rs`) makes the sections of the file from them; a file's own sections come to the editor the same way.

export type SectionStartKind = "next" | "cont" | "even" | "odd";

export interface SectionSpec {
	// Where the section starts: on a new page, on the same one, or on the next even or odd page
	start: SectionStartKind;
	landscape: boolean;
	// Points: top, right, bottom, left; null leaves the margins as they were
	margins: [number, number, number, number] | null;
	columns: 1 | 2 | 3;
	// The header and footer text of the section: null leaves what it has (for a new section, what the one before has), "" takes it away
	header: string | null;
	footer: string | null;
	// The page number the section starts at, "c" to carry on from the section before, null to leave it
	num: number | "c" | null;
	// The header and footer of its first page and of its even pages, as above
	firstHeader: string | null;
	firstFooter: string | null;
	evenHeader: string | null;
	evenFooter: string | null;
}

export const NEW_SECTION: SectionSpec = { start: "next", landscape: false, margins: null, columns: 1, header: null, footer: null, num: null, firstHeader: null, firstFooter: null, evenHeader: null, evenFooter: null };

// Text in the set-up is `=` and its UTF-8 bytes in hex, so that no character of it can be taken for a separator
const toHex = (t: string) => `=${Array.from(new TextEncoder().encode(t), (b) => b.toString(16).padStart(2, "0")).join("")}`;
function fromHex(f: string | undefined): string | null {
	if (!f || !f.startsWith("=")) return null;
	const h = f.slice(1);
	if (h.length % 2 || !/^[0-9a-f]*$/i.test(h)) return null;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(h.match(/../g) ?? [], (x) => Number.parseInt(x, 16)));
	} catch {
		return null;
	}
}

const KEYS = { fh: "firstHeader", ff: "firstFooter", eh: "evenHeader", ef: "evenFooter" } as const;

export function parseSection(s: string): SectionSpec | null {
	const [kind, orient, margins, cols, header, footer, ...rest] = s.split("|");
	const columns = Number(cols);
	if (!["next", "cont", "even", "odd"].includes(kind) || (orient !== "p" && orient !== "l") || ![1, 2, 3].includes(columns)) return null;
	let m: SectionSpec["margins"] = null;
	if (margins) {
		const v = margins.split(",").map(Number);
		if (v.length !== 4 || v.some((x) => !Number.isFinite(x) || x < 0 || x > 500)) return null;
		m = [v[0], v[1], v[2], v[3]];
	}
	const spec: SectionSpec = { ...NEW_SECTION, start: kind as SectionStartKind, landscape: orient === "l", margins: m, columns: columns as 1 | 2 | 3, header: fromHex(header), footer: fromHex(footer) };
	for (const piece of rest) {
		const [key, value = ""] = [piece.slice(0, piece.indexOf("=")), piece.slice(piece.indexOf("=") + 1)];
		if (key === "num") spec.num = value === "c" ? "c" : Number(value) >= 1 ? Number(value) : null;
		else if (key in KEYS) spec[KEYS[key as keyof typeof KEYS]] = fromHex(`=${value}`);
	}
	return spec;
}

export function formatSection(s: SectionSpec): string {
	const extras: string[] = [];
	if (s.num !== null) extras.push(`num=${s.num}`);
	for (const [key, field] of Object.entries(KEYS)) {
		const v = s[field];
		if (v !== null) extras.push(`${key}=${toHex(v).slice(1)}`);
	}
	const tail = s.header === null && s.footer === null && extras.length === 0 ? "" : `|${s.header === null ? "" : toHex(s.header)}|${s.footer === null ? "" : toHex(s.footer)}${extras.map((e) => `|${e}`).join("")}`;
	return `${s.start}|${s.landscape ? "l" : "p"}|${s.margins ? s.margins.join(",") : ""}|${s.columns}${tail}`;
}

type Block = { id: string; props?: Record<string, unknown>; children?: Block[] };

const contains = (b: Block, id: string): boolean => b.id === id || !!b.children?.some((c) => contains(c, id));

// The block that starts the section the caret is in: the nearest top-level block at or before the caret's that has a set-up, or null in the first section
export function sectionStart(top: Block[], caretId: string): { block: Block; spec: SectionSpec } | null {
	const at = top.findIndex((b) => contains(b, caretId));
	for (let i = at; i >= 0; i--) {
		const raw = top[i].props?.sectionBreak;
		const spec = typeof raw === "string" && raw ? parseSection(raw) : null;
		if (spec) return { block: top[i], spec };
	}
	return null;
}

// How many sections the document has
export const sectionCount = (top: Block[]): number => 1 + top.filter((b) => typeof b.props?.sectionBreak === "string" && b.props.sectionBreak).length;
