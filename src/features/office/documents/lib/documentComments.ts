// Where a comment on a document sits. A document is a ProseMirror tree, not one run of text, so a comment keeps the id of its block,
// the offsets inside that block and the words. It is found again by the block and offsets while they still hold the words, and
// otherwise by searching for the words (nearest to where they were), as notes do (see features/chat/lib/anchors.ts).
// ponytail: offsets are numbers, not Yjs relative positions, so words edited inside a comment lose it (it shows as orphaned);
// upgrade to y-prosemirror relative positions if that matters.

import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { MAX_QUOTE, type Placement } from "@/features/chat/lib/anchors";
import type { Anchor } from "@/features/chat/lib/entries";

export interface MarkedThread {
	id: string;
	anchor: Anchor;
}

interface Pm {
	descendants: (f: (node: { isTextblock: boolean; textContent: string; attrs: Record<string, unknown> }, pos: number, parent: { attrs: Record<string, unknown> } | null) => boolean | void) => void;
}

interface Textblock {
	id: string;
	start: number; // The position of the first character
	text: string;
}

export function textblocks(doc: Pm): Textblock[] {
	const out: Textblock[] = [];
	doc.descendants((node, pos, parent) => {
		if (!node.isTextblock) return true;
		out.push({ id: String(parent?.attrs.id ?? ""), start: pos + 1, text: node.textContent });
		return false;
	});
	return out;
}

// The anchor for the words between two positions that sit in one block (a selection over several blocks keeps its first block)
export function makeDocAnchor(doc: Pm, from: number, to: number): Anchor | null {
	const b = textblocks(doc).find((t) => from >= t.start && from <= t.start + t.text.length);
	if (!b || !b.id) return null;
	const f = from - b.start;
	const t = Math.min(to - b.start, b.text.length);
	if (t <= f) return null;
	return { from: { block: b.id, at: f }, to: { block: b.id, at: t }, quote: b.text.slice(f, t).slice(0, MAX_QUOTE) };
}

const pos = (v: unknown): { block: string; at: number } | null => {
	const r = v as { block?: unknown; at?: unknown } | null;
	return r && typeof r.block === "string" && typeof r.at === "number" ? { block: r.block, at: r.at } : null;
};

export function locateDocAnchor(doc: Pm, anchor: Anchor): Placement {
	const blocks = textblocks(doc);
	const f = pos(anchor.from);
	const t = pos(anchor.to);
	const q = anchor.quote;
	const home = f && blocks.find((b) => b.id === f.block);
	if (home && f && t && home.text.slice(f.at, t.at) === q && q) return { state: "on", from: home.start + f.at, to: home.start + t.at };
	// The words moved or the block was replaced: look for them, nearest to where they were
	if (q) {
		const near = home ? home.start + (f?.at ?? 0) : 0;
		let best: number | null = null;
		for (const b of blocks)
			for (let i = b.text.indexOf(q); i >= 0; i = b.text.indexOf(q, i + 1)) if (best === null || Math.abs(b.start + i - near) < Math.abs(best - near)) best = b.start + i;
		if (best !== null) return { state: "moved", from: best, to: best + q.length };
	}
	return { state: "orphaned" };
}

// What the editor draws: the open threads and the chosen one. The page sets `threads` and `active` and calls `refresh`.
export interface CommentStore {
	threads: MarkedThread[];
	active: string | null;
	onOpen: (id: string) => void;
}

export const newCommentStore = (): CommentStore => ({ threads: [], active: null, onOpen: () => {} });

const key = new PluginKey("docComments");

export const refreshComments = (view: EditorView) => view.dispatch(view.state.tr.setMeta(key, true));

export function commentsPlugin(store: CommentStore): Plugin {
	const build = (state: EditorState) =>
		DecorationSet.create(
			state.doc,
			store.threads.flatMap((t) => {
				const at = locateDocAnchor(state.doc as unknown as Pm, t.anchor);
				return at.state === "orphaned" || at.to <= at.from ? [] : [Decoration.inline(at.from, at.to, { class: t.id === store.active ? "doc-comment doc-comment-active" : "doc-comment", "data-thread": t.id })];
			}),
		);
	return new Plugin({
		key,
		state: {
			init: (_, state) => build(state),
			apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(key) ? build(state) : old),
		},
		props: {
			decorations: (state) => key.getState(state),
			handleDOMEvents: {
				click: (_v, e) => {
					const id = (e.target as HTMLElement | null)?.closest?.("[data-thread]")?.getAttribute("data-thread");
					if (id) store.onOpen(id);
					return false;
				},
			},
		},
	});
}
