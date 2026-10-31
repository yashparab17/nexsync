// Content controls: a form field a person fills in, in the document and in the file (Word's content controls). The words of a control carry
// its set-up as one text mark, `kind|title|tag|items|state`: the kind is rich, text, check, drop, combo or date; the title, the tag and each
// item (joined by a comma) are the UTF-8 bytes in hex; the state is 1 or 0 for a check box and the date (ISO 8601) for a date.
// The backend (`controls.rs`) puts the file's own control round the words, and a file's controls come to the editor the same way.

import type { EditorView } from "@tiptap/pm/view";

export type ControlKind = "rich" | "text" | "check" | "drop" | "combo" | "date";

export interface ControlSpec {
	kind: ControlKind;
	title: string;
	tag: string;
	items: string[];
	// "1" or "0" for a check box, an ISO date for a date, otherwise empty
	state: string;
}

export const CONTROL_KINDS: [ControlKind, string][] = [
	["text", "Plain text"],
	["rich", "Rich text"],
	["check", "Check box"],
	["drop", "Drop-down list"],
	["combo", "Combo box"],
	["date", "Date"],
];

export const TICKED = "\u2612";
export const UNTICKED = "\u2610";

const toHex = (t: string) => Array.from(new TextEncoder().encode(t), (b) => b.toString(16).padStart(2, "0")).join("");
function fromHex(h: string): string | null {
	if (h.length % 2 || !/^[0-9a-f]*$/i.test(h)) return null;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(h.match(/../g) ?? [], (x) => Number.parseInt(x, 16)));
	} catch {
		return null;
	}
}

export function parseControl(s: string): ControlSpec | null {
	const [kind, title = "", tag = "", items = "", state = ""] = s.split("|");
	if (!CONTROL_KINDS.some(([k]) => k === kind)) return null;
	const t = fromHex(title);
	const g = fromHex(tag);
	if (t === null || g === null) return null;
	return { kind: kind as ControlKind, title: t, tag: g, items: items ? items.split(",").map((i) => fromHex(i) ?? "") : [], state };
}

export const formatControl = (c: ControlSpec): string => `${c.kind}|${toHex(c.title)}|${toHex(c.tag)}|${c.items.map(toHex).join(",")}|${c.state}`;

// An equation is a range of the same kind: its source (LaTeX, or the linear form) in hex, and its words as the text the editor shows. In the file
// it is Word's own equation, which Word lays out as built-up maths.
export const equationSpec = (source: string): string => `eq|${toHex(source)}`;
export const isEquation = (value: string): boolean => value.startsWith("eq|");

// What a new control shows before anything is chosen or typed
export function placeholderOf(c: ControlSpec): string {
	switch (c.kind) {
		case "check":
			return c.state === "1" ? TICKED : UNTICKED;
		case "drop":
		case "combo":
			return c.items[0] ?? "Choose an item";
		case "date":
			return c.state ? new Date(c.state).toLocaleDateString() : "Click to enter a date";
		default:
			return "Click to enter text";
	}
}

// The words of the control the caret is in: where they start and end, and its set-up
export function controlAt(view: EditorView, pos = view.state.selection.from): { from: number; to: number; spec: ControlSpec; raw: string } | null {
	const mark = view.state.schema.marks.contentControl;
	if (!mark) return null;
	const $pos = view.state.doc.resolve(pos);
	const parent = $pos.parent;
	let found: { from: number; to: number; raw: string } | null = null;
	parent.forEach((child, offset) => {
		const m = child.marks.find((x) => x.type === mark);
		if (!m || !child.isText) return;
		const from = $pos.start() + offset;
		const to = from + child.nodeSize;
		if (pos >= from && pos <= to) found = { from, to, raw: String(m.attrs.stringValue ?? "") };
	});
	const hit = found as { from: number; to: number; raw: string } | null;
	if (!hit) return null;
	// Neighbouring pieces of text with the same set-up are one control
	let { from, to } = hit;
	parent.forEach((child, offset) => {
		const m = child.marks.find((x) => x.type === mark);
		const a = $pos.start() + offset;
		if (m && String(m.attrs.stringValue ?? "") === hit.raw) {
			if (a + child.nodeSize === from) from = a;
			else if (a === to) to = a + child.nodeSize;
		}
	});
	const spec = parseControl(hit.raw);
	return spec ? { from, to, spec, raw: hit.raw } : null;
}

// Ticks or unticks the check box at a place (a click on it): the symbol and the state change together
export function toggleCheckAt(view: EditorView, pos: number): boolean {
	const found = controlAt(view, pos);
	if (!found || found.spec.kind !== "check") return false;
	const next: ControlSpec = { ...found.spec, state: found.spec.state === "1" ? "0" : "1" };
	const mark = view.state.schema.marks.contentControl.create({ stringValue: formatControl(next) });
	view.dispatch(view.state.tr.replaceWith(found.from, found.to, view.state.schema.text(next.state === "1" ? TICKED : UNTICKED, [mark])));
	return true;
}

// Gives a control new words and set-up (the dialog's Apply)
export function setControl(view: EditorView, at: { from: number; to: number }, spec: ControlSpec, text: string): void {
	const mark = view.state.schema.marks.contentControl.create({ stringValue: formatControl(spec) });
	view.dispatch(view.state.tr.replaceWith(at.from, at.to, view.state.schema.text(text || placeholderOf(spec), [mark])));
}
