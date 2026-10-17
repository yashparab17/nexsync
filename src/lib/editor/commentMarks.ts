// Shows the open comments of a file inside the editor: the commented words get a soft highlight, and clicking one opens its
// thread. Where each comment sits is worked out from its Yjs anchor every time the text changes, so a comment follows its
// words while other people type and when a line is moved.

import { StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import * as Y from "yjs";

import { locateAnchor } from "@/features/chat/lib/anchors";
import type { Anchor } from "@/features/chat/lib/entries";

export interface MarkedThread {
	id: string;
	anchor: Anchor;
}

// The panel tells the editor which threads to show (the open ones) and which one is chosen
export const setCommentThreads = StateEffect.define<{ threads: MarkedThread[]; active: string | null }>();

const field = StateField.define<{ threads: MarkedThread[]; active: string | null }>({
	create: () => ({ threads: [], active: null }),
	update(value, tr) {
		for (const e of tr.effects) if (e.is(setCommentThreads)) return e.value;
		return value;
	},
});

const theme = EditorView.baseTheme({
	".cm-comment": { backgroundColor: "color-mix(in oklch, var(--warning) 20%, transparent)", cursor: "pointer" },
	".cm-comment-active": { backgroundColor: "color-mix(in oklch, var(--warning) 42%, transparent)" },
});

// `onAdd` is called for Ctrl+Alt+M, to start a comment on the selection
export function commentMarks(doc: Y.Doc, ytext: Y.Text, onOpen: (id: string) => void, onAdd: () => void): Extension {
	const plugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(readonly view: EditorView) {
				this.decorations = this.build();
			}
			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(setCommentThreads)))) this.decorations = this.build();
			}
			private build(): DecorationSet {
				const { threads, active } = this.view.state.field(field);
				const length = this.view.state.doc.length;
				const ranges: Range<Decoration>[] = [];
				for (const t of threads) {
					const at = locateAnchor(doc, ytext, t.anchor);
					if (at.state === "orphaned" || at.to > length || at.to <= at.from) continue;
					ranges.push(Decoration.mark({ class: t.id === active ? "cm-comment cm-comment-active" : "cm-comment", attributes: { "data-thread": t.id } }).range(at.from, at.to));
				}
				return Decoration.set(ranges, true);
			}
		},
		{ decorations: (v) => v.decorations },
	);
	const clicks = EditorView.domEventHandlers({
		click(event) {
			const mark = (event.target as HTMLElement | null)?.closest?.("[data-thread]");
			const id = mark?.getAttribute("data-thread");
			if (id) onOpen(id);
			return false;
		},
	});
	const keys = keymap.of([
		{
			key: "Mod-Alt-m",
			run: () => {
				onAdd();
				return true;
			},
		},
	]);
	return [field, plugin, clicks, keys, theme];
}
