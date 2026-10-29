// Tracked changes in a document. An insertion and a deletion are two character styles whose value is "author|date"; while a person is
// suggesting, what they type is marked as inserted and what they delete is marked as deleted (and stays on the page, struck through)
// until someone accepts or rejects it. The marks are in the shared text, so everyone sees them, and they go to the file as Word's
// w:ins and w:del (see the Rust side). `compareLines` is the other source of changes: two versions of a text, side by side.
//
// Two people reviewing at once can leave a mark behind: when one accepts or rejects a change while another types inside or beside it,
// the merged text can carry the resolved change's mark again, on words nobody suggested (RESEARCH.md §8p: 16% of two-person and 34% of
// three-person sessions in simulation). So every resolved mark value goes on a shared list, and a mark whose value is on it is
// removed wherever it turns up (`strayMarks`, `staleMarksPlugin`). A pending deletion mark that spreads onto neighbouring new text is
// not caught (0.4% and 1.4% of sessions), since nothing says the text was not part of it.

import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { Mark, Node as PmNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import { diffLines, diffWords } from "@/lib/diff";

export type ChangeKind = "insertion" | "deletion";

export const markValue = (author: string, at = new Date()): string => `${author.replace(/\|/g, "/")}|${at.toISOString()}`;

export function readMark(value: string): { author: string; date: string } {
	const i = value.indexOf("|");
	return i < 0 ? { author: value, date: "" } : { author: value.slice(0, i), date: value.slice(i + 1) };
}

export interface Change {
	kind: ChangeKind;
	from: number;
	to: number;
	author: string;
	date: string;
	text: string;
	// Every mark value inside it: each stretch of typing has its own date
	values: string[];
}

const markOf = (m: readonly Mark[]): { kind: ChangeKind; value: string } | null => {
	for (const x of m) if (x.type.name === "insertion" || x.type.name === "deletion") return { kind: x.type.name, value: String(x.attrs.stringValue ?? "") };
	return null;
};

// The changes in a document, in order: neighbouring text with the same mark is one change
export function changesOf(doc: PmNode): Change[] {
	const out: Change[] = [];
	doc.descendants((node, pos) => {
		if (!node.isText) return true;
		const m = markOf(node.marks);
		if (!m) return false;
		const last = out[out.length - 1];
		if (last && last.kind === m.kind && last.to === pos && last.author === readMark(m.value).author) {
			last.to = pos + node.nodeSize;
			last.text += node.text ?? "";
			if (!last.values.includes(m.value)) last.values.push(m.value);
		} else out.push({ kind: m.kind, from: pos, to: pos + node.nodeSize, text: node.text ?? "", values: [m.value], ...readMark(m.value) });
		return false;
	});
	return out;
}

// Accepting an insertion or rejecting a deletion keeps the text and drops the mark; the other two remove the text. From the end back,
// so the positions of the changes still to do hold.
export function resolveChanges(view: EditorView, changes: Change[], accept: boolean, store?: ReviewStore): void {
	// Written first, so a device that merges the resolution and a late edit finds the list already there
	store?.resolved?.add(changes.flatMap((c) => c.values));
	const tr = view.state.tr;
	for (const c of [...changes].sort((a, b) => b.from - a.from)) {
		const keep = (c.kind === "insertion") === accept;
		if (keep) tr.removeMark(c.from, c.to, view.state.schema.marks[c.kind]);
		else tr.delete(c.from, c.to);
	}
	tr.setMeta(reviewKey, "resolved");
	view.dispatch(tr);
}

// The change at or after a position (or before it), wrapping round
export function nextChange(changes: Change[], pos: number, backwards = false): Change | undefined {
	if (!changes.length) return undefined;
	if (backwards) return [...changes].reverse().find((c) => c.to < pos) ?? changes[changes.length - 1];
	return changes.find((c) => c.from >= pos) ?? changes[0];
}

// The mark values of changes that have been accepted or rejected, shared by everyone with the document
export interface ResolvedSet {
	has(value: string): boolean;
	add(values: string[]): void;
	size(): number;
	// Calls back when the list changes (also for what other people add); returns the way to stop
	watch(cb: () => void): () => void;
}

// A Y.Map, as far as the list needs one
interface ResolvedMap {
	has(key: string): boolean;
	set(key: string, value: boolean): unknown;
	size: number;
	observe(cb: () => void): void;
	unobserve(cb: () => void): void;
	doc?: { transact(fn: () => void): void } | null;
}

// ponytail: nothing is ever removed from the list; every mark value of a resolved change stays (about 55 bytes each). Drop old ones if a document's list grows large.
export function resolvedSetOf(map: ResolvedMap): ResolvedSet {
	return {
		has: (v) => map.has(v),
		add: (values) => {
			const fresh = values.filter((v) => !map.has(v));
			if (!fresh.length) return;
			const write = () => fresh.forEach((v) => map.set(v, true));
			if (map.doc) map.doc.transact(write);
			else write();
		},
		size: () => map.size,
		watch: (cb) => {
			map.observe(cb);
			return () => map.unobserve(cb);
		},
	};
}

export interface ReviewStore {
	suggesting: boolean;
	author: string;
	resolved?: ResolvedSet;
}

export const newReviewStore = (author = "", resolved?: ResolvedSet): ReviewStore => ({ suggesting: false, author, resolved });

const reviewKey = new PluginKey("docReview");

// Ranges of the final document that the transaction's steps inserted
function inserted(tr: Transaction): [number, number][] {
	const out: [number, number][] = [];
	tr.steps.forEach((step, i) => {
		const later = tr.mapping.slice(i + 1);
		step.getMap().forEach((_a, _b, from, to) => {
			if (to > from) out.push([later.map(from, 1), later.map(to, -1)]);
		});
	});
	return out;
}

const fromOthers = (tr: Transaction) => tr.getMeta("y-sync$") != null || tr.getMeta(reviewKey) != null || tr.getMeta("addToHistory") === false;

export function suggestingPlugin(store: ReviewStore): Plugin {
	const mine = (m: readonly Mark[]) => {
		const x = markOf(m);
		return x?.kind === "insertion" && readMark(x.value).author === store.author;
	};
	// Deleting while suggesting marks the words as deleted. Words this person inserted themselves are simply removed.
	const strike = (view: EditorView, from: number, to: number, caretAt: number): boolean => {
		const { state } = view;
		let own = true;
		let any = false;
		state.doc.nodesBetween(from, to, (n) => {
			if (n.isText) {
				any = true;
				if (!mine(n.marks)) own = false;
			}
		});
		if (!any || own) return false;
		const del = state.schema.marks.deletion;
		if (!del) return false;
		const tr = state.tr.addMark(from, to, del.create({ stringValue: markValue(store.author) })).setMeta(reviewKey, "strike");
		tr.setSelection(TextSelection.create(tr.doc, caretAt));
		view.dispatch(tr);
		return true;
	};
	return new Plugin({
		key: reviewKey,
		appendTransaction(trs: readonly Transaction[], _old: EditorState, state: EditorState) {
			if (!store.suggesting || !state.schema.marks.insertion) return null;
			const ranges = trs.filter((t) => t.docChanged && !fromOthers(t)).flatMap(inserted);
			if (!ranges.length) return null;
			const tr = state.tr;
			const ins = state.schema.marks.insertion.create({ stringValue: markValue(store.author) });
			// Text typed beside struck words is not struck itself
			for (const [from, to] of ranges)
				if (to > from && to <= state.doc.content.size) {
					if (state.schema.marks.deletion) tr.removeMark(from, to, state.schema.marks.deletion);
					tr.addMark(from, to, ins);
				}
			return tr.steps.length ? tr.setMeta(reviewKey, "mark").setMeta("addToHistory", true) : null;
		},
		props: {
			handleKeyDown(view, e) {
				if (!store.suggesting || (e.key !== "Backspace" && e.key !== "Delete") || e.ctrlKey || e.metaKey) return false;
				const { from, to, empty } = view.state.selection;
				if (!empty) return strike(view, from, to, e.key === "Backspace" ? from : to);
				if (e.key === "Backspace") return from > 0 && strike(view, from - 1, from, from - 1);
				return strike(view, from, from + 1, from + 1);
			},
			handleTextInput(view, from, to, text) {
				if (!store.suggesting || from === to) return false;
				// Typing over a selection: the selection is struck, the new text goes after it
				if (!strike(view, from, to, to)) return false;
				view.dispatch(view.state.tr.insertText(text, to));
				return true;
			},
		},
	});
}

// Marks in the text whose change was already accepted or rejected
export function strayMarks(doc: PmNode, resolved: ResolvedSet): { from: number; to: number; kind: ChangeKind }[] {
	const out: { from: number; to: number; kind: ChangeKind }[] = [];
	if (resolved.size() === 0) return out;
	doc.descendants((node, pos) => {
		if (!node.isText) return true;
		for (const m of node.marks) {
			const kind = m.type.name;
			if ((kind === "insertion" || kind === "deletion") && resolved.has(String(m.attrs.stringValue ?? ""))) out.push({ from: pos, to: pos + node.nodeSize, kind });
		}
		return false;
	});
	return out;
}

const isRemote = (tr: Transaction) => tr.getMeta("y-sync$") != null;

// Removes stray marks after a merge, and when the list of resolved changes grows. It is not typing, so it is not marked as a
// suggestion and not put on the undo stack; every device does the same, so they stay in step.
export function staleMarksPlugin(store: ReviewStore): Plugin {
	return new Plugin({
		key: staleKey,
		appendTransaction(trs: readonly Transaction[], _old: EditorState, state: EditorState) {
			const resolved = store.resolved;
			if (!resolved || resolved.size() === 0) return null;
			if (!trs.some((t) => (t.docChanged && isRemote(t)) || t.getMeta(staleKey) === "check")) return null;
			const strays = strayMarks(state.doc, resolved);
			if (!strays.length) return null;
			const tr = state.tr;
			for (const s of strays) tr.removeMark(s.from, s.to, state.schema.marks[s.kind]);
			return tr.setMeta(reviewKey, "repair").setMeta("addToHistory", false);
		},
		view(view: EditorView) {
			const check = () => {
				if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(staleKey, "check"));
			};
			const stop = store.resolved?.watch(check);
			// A copy opened with changes already on the list is cleaned too
			queueMicrotask(check);
			return { destroy: () => stop?.() };
		},
	});
}

const staleKey = new PluginKey("docStaleMarks");

// ----- Compare: two versions of a text, as insertions and deletions

export interface Piece {
	kind: "same" | ChangeKind;
	text: string;
}

export interface CompareRow {
	kind: "same" | "inserted" | "deleted" | "changed";
	pieces: Piece[];
}

export interface Comparison {
	rows: CompareRow[];
	insertions: number;
	deletions: number;
}

// Line by line (a line is a paragraph, or a table row with tabs between its cells); the words of a paragraph that was edited are
// compared too, so only they are marked.
export function compareLines(before: string[], after: string[]): Comparison {
	const r = diffLines(before.join("\n"), after.join("\n"));
	const rows: CompareRow[] = [];
	let insertions = 0;
	let deletions = 0;
	for (let i = 0; i < r.rows.length; i++) {
		const row = r.rows[i];
		if (row.kind === "same") rows.push({ kind: "same", pieces: [{ kind: "same", text: row.text }] });
		else if (row.kind === "del" && r.rows[i + 1]?.kind === "add") {
			// A paragraph that was edited: its old and new text side by side, word by word
			const next = r.rows[++i];
			const w = diffWords(row.text, next.text);
			const pieces: Piece[] = [];
			if (w) {
				// Old words that went, then the new ones that came, in the order of the new text
				let o = 0;
				for (const seg of w.new) {
					while (o < w.old.length && w.old[o].changed) {
						pieces.push({ kind: "deletion", text: w.old[o].text });
						deletions++;
						o++;
					}
					if (o < w.old.length && !seg.changed) o++;
					pieces.push({ kind: seg.changed ? "insertion" : "same", text: seg.text });
					if (seg.changed) insertions++;
				}
				for (; o < w.old.length; o++) if (w.old[o].changed) (pieces.push({ kind: "deletion", text: w.old[o].text }), deletions++);
			} else {
				pieces.push({ kind: "deletion", text: row.text }, { kind: "insertion", text: next.text });
				deletions++;
				insertions++;
			}
			rows.push({ kind: "changed", pieces });
		} else if (row.kind === "add") {
			rows.push({ kind: "inserted", pieces: [{ kind: "insertion", text: row.text }] });
			insertions++;
		} else {
			rows.push({ kind: "deleted", pieces: [{ kind: "deletion", text: row.text }] });
			deletions++;
		}
	}
	return { rows, insertions, deletions };
}
