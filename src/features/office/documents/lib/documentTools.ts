// Small document operations that are plain data transformations: sorting a table, a table of contents, figure captions, and
// smart quotes as the person types.

import { Plugin } from "@tiptap/pm/state";

import { CLOSE, OPEN, parseNoteValue } from "@/features/office/documents/lib/documentNotes";

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

// Words that are nearly always a slip, and what was meant
const CORRECTIONS: Record<string, string> = {
	teh: "the", adn: "and", taht: "that", wiht: "with", wich: "which", thier: "their", becuase: "because", beleive: "believe", freind: "friend",
	recieve: "receive", recieved: "received", occured: "occurred", occurence: "occurrence", seperate: "separate", definately: "definitely",
	alot: "a lot", untill: "until", tommorow: "tomorrow", accomodate: "accommodate", acheive: "achieve", adress: "address", begining: "beginning",
	calender: "calendar", enviroment: "environment", existance: "existence", foriegn: "foreign", goverment: "government", independant: "independent",
	publically: "publicly", refered: "referred", succesful: "successful", wierd: "weird", writting: "writing",
	dont: "don't", cant: "can't", wont: "won't", doesnt: "doesn't", isnt: "isn't", wasnt: "wasn't", didnt: "didn't", couldnt: "couldn't", shouldnt: "shouldn't", wouldnt: "wouldn't",
};

// A full stop after these does not end a sentence
const ABBREVIATIONS = new Set(["e.g", "i.e", "etc", "vs", "approx", "fig", "eq", "dr", "mr", "mrs", "ms", "prof", "inc", "ltd", "st", "cf", "al", "no", "p", "pp"]);

// The word before the caret, put right: a slip from the list, two capitals at the start, a lone i, a small letter that starts a sentence.
// `ch` is what was typed after it; null when the word is fine. Only a space makes a sentence start (so "e.g." is left alone), and a word
// with a capital inside (iPhone, eBay) is never touched.
function correctWord(before: string, ch: string): { remove: number; insert: string } | null {
	const m = /([A-Za-z][A-Za-z']*)$/.exec(before);
	if (!m || !/^[ .,;:!?)']$/.test(ch)) return null;
	const word = m[1];
	const prefix = before.slice(0, before.length - word.length);
	if (/[\p{L}\p{N}/@._-]$/u.test(prefix) && !/[.!?]["')\]]*\s+$/.test(prefix)) return null; // part of a longer word, a path or an address
	let fixed = word;
	if (word === "i" && (ch === " " || ch === "'")) fixed = "I";
	else if (ch !== "'") {
		const hit = CORRECTIONS[word.toLowerCase()];
		if (hit) fixed = word === word.toUpperCase() && word.length > 1 ? hit.toUpperCase() : /^[A-Z]/.test(word) ? hit[0].toUpperCase() + hit.slice(1) : hit;
		else if (/^[A-Z]{2}[a-z]+$/.test(word) && word.slice(2) !== "s") fixed = word[0] + word.slice(1).toLowerCase();
	}
	if (ch === " " && /^[a-z][a-z']*$/.test(fixed)) {
		const starts = prefix === "" || /\n$/.test(prefix) || (/[.!?]["')\]]*\s+$/.test(prefix) && !ABBREVIATIONS.has((/([A-Za-z.]+)[.!?]["')\]]*\s+$/.exec(prefix)?.[1] ?? "").replace(/\.$/, "").toLowerCase()) && !/[0-9][.!?]\s+$/.test(prefix));
		if (starts) fixed = fixed[0].toUpperCase() + fixed.slice(1);
	}
	return fixed === word ? null : { remove: word.length, insert: fixed + (ch === "'" ? "'" : ch) };
}

// What typing one character turns the text before it into: (c) (r) (tm) become symbols, -- a dash, ... an ellipsis, -> an arrow; after a
// word, a slip from the list is put right, two capitals at the start of a word become one, i becomes I, and a sentence starts with a capital
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
	return correctWord(before, ch);
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

// Each person turns AutoCorrect and smart quotes off for themselves (kept in the browser, so it is not part of the shared document)
const AUTOCORRECT_KEY = "docAutoCorrect";
export function autoCorrectOn(): boolean {
	try {
		return localStorage.getItem(AUTOCORRECT_KEY) !== "off";
	} catch {
		return true;
	}
}
export function setAutoCorrect(on: boolean) {
	try {
		localStorage.setItem(AUTOCORRECT_KEY, on ? "on" : "off");
	} catch {
		// private window: the choice lasts until the page is closed only
	}
}

export const smartQuotesPlugin = new Plugin({
	props: {
		handleTextInput(view, from, to, text) {
			if (text.length !== 1 || !autoCorrectOn()) return false;
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
	if (!html.includes("data-page-break-before") && !html.includes("<img") && !html.includes("data-style-id") && !html.includes("data-note") && !html.includes("data-section-break") && !html.includes("data-char-style") && !html.includes("data-table-style")) return html;
	const d = new DOMParser().parseFromString(html, "text/html");
	// A reference to a footnote or endnote goes as its marker (see `documentNotes`)
	d.body.querySelectorAll<HTMLElement>("[data-note]").forEach((el) => {
		const p = parseNoteValue(el.dataset.note ?? "");
		el.replaceWith(d.createTextNode(p ? `${OPEN}${p.id}${CLOSE}` : ""));
	});
	// Words in a character style are wrapped in markers: the style's id between two of them, the words, and a third (read in `notes.rs`, with the notes)
	d.body.querySelectorAll<HTMLElement>("[data-char-style]").forEach((el) => {
		const id = el.dataset.charStyle ?? "";
		if (!id || /[\uE000-\uE00A]/.test(id)) return el.replaceWith(...Array.from(el.childNodes));
		el.prepend(d.createTextNode(`\uE006${id}\uE007`));
		el.append(d.createTextNode("\uE008"));
	});
	// A table in a table style carries its id at the start of its first cell (put first of the paragraph's markers, so that it stands last of them)
	const styled = new Set<Element>();
	d.body.querySelectorAll<HTMLElement>("span[data-table-style]").forEach((el) => {
		const id = el.dataset.tableStyle ?? "";
		const cell = el.closest("td, th");
		if (id && !/[\uE000-\uE00A]/.test(id) && cell && !styled.has(cell)) {
			styled.add(cell);
			const target = cell.querySelector("p") ?? cell;
			target.insertBefore(d.createTextNode(`\uE009${id}\uE00A`), target.firstChild);
		}
		el.replaceWith(...Array.from(el.childNodes));
	});
	// A paragraph that starts a section carries its page set-up the same way (put first, so that the style's marker, put after, stands first)
	d.body.querySelectorAll<HTMLElement>("[data-section-break]").forEach((el) => {
		const spec = el.getAttribute("data-section-break");
		if (!spec || /[\uE000-\uE005]/.test(spec) || ["IMG", "HR", "BR", "TABLE"].includes(el.tagName)) return;
		const target = el.tagName === "LI" ? (el.querySelector(":scope > p") ?? el) : el;
		target.insertBefore(d.createTextNode(`\uE004${spec}\uE005`), target.firstChild);
	});
	// A paragraph's style goes to the backend as its id between two private-use characters at the start of its text (read there by `styles.rs`)
	d.body.querySelectorAll<HTMLElement>("[data-style-id]").forEach((el) => {
		const id = el.getAttribute("data-style-id");
		if (!id || /[]/.test(id) || ["IMG", "HR", "BR", "TABLE"].includes(el.tagName)) return;
		const target = el.tagName === "LI" ? (el.querySelector(":scope > p") ?? el) : el;
		target.insertBefore(d.createTextNode(`${id}`), target.firstChild);
	});
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
