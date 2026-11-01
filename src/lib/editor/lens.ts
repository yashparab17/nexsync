// The merge lens: shows in the text where two people's writing met. When two devices insert at the same place while apart,
// Yjs has to decide the order, and the result reads as one text although two people wrote it. Both inserts remember the
// characters they were put between, so two inserts by different people between the same two characters are exactly the
// places where a merge happened. The lens marks them, and tints every line with the colour of whoever wrote most of it.

import { StateEffect, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import * as Y from "yjs";

import { colorOf } from "@/lib/collabColor";
import { blameLines, type AuthorInfo } from "@/lib/editor/blame";

export interface MergeSpot {
	from: number;
	to: number;
	// Who wrote there, in the order their text reads
	authors: string[];
}

interface Id {
	client: number;
	clock: number;
}

interface Item {
	deleted: boolean;
	right: Item | null;
	id: Id;
	origin: Id | null;
	rightOrigin: Id | null;
	content: { str?: string };
}

const keyOf = (id: Id | null) => (id ? `${id.client}:${id.clock}` : "-");

// A stretch of text one session wrote in one go; `key` names the two characters it was put between
export interface Run {
	client: number;
	from: number;
	to: number;
	key: string;
}

// ponytail: reads Yjs internals (as blame.ts does) and walks the whole text; fine for source files, cache by state vector if huge ones matter.
export function mergeSpots(ytext: Y.Text, authors: Y.Map<AuthorInfo>): MergeSpot[] {
	const runs: Run[] = [];
	let pos = 0;
	for (let item = (ytext as unknown as { _start: Item | null })._start; item; item = item.right) {
		const str = item.deleted ? undefined : item.content.str;
		if (str === undefined) continue;
		runs.push({ client: item.id.client, from: pos, to: pos + str.length, key: `${keyOf(item.origin)}|${keyOf(item.rightOrigin)}` });
		pos += str.length;
	}
	return spotsFrom(runs, authors);
}

// Two runs by different people put between the same two characters are where a merge happened
export function spotsFrom(runs: Run[], authors: Y.Map<AuthorInfo>): MergeSpot[] {
	const groups = new Map<string, Run[]>();
	for (const r of runs) groups.set(r.key, [...(groups.get(r.key) ?? []), r]);
	const spots: MergeSpot[] = [];
	for (const list of groups.values()) {
		if (new Set(list.map((p) => p.client)).size < 2) continue;
		const names: string[] = [];
		for (const p of list) {
			const name = authors.get(String(p.client))?.name ?? "Unknown";
			if (!names.includes(name)) names.push(name);
		}
		// Two sessions of one person are not two people meeting
		if (names.length < 2) continue;
		spots.push({ from: Math.min(...list.map((p) => p.from)), to: Math.max(...list.map((p) => p.to)), authors: names });
	}
	return spots.sort((a, b) => a.from - b.from);
}

const refresh = StateEffect.define<null>();

const theme = EditorView.baseTheme({
	".cm-lens-line": { boxShadow: "inset 3px 0 0 var(--lens)", backgroundColor: "color-mix(in oklch, var(--lens) 7%, transparent)" },
	".cm-lens-merge": { borderBottom: "2px dotted var(--foreground)", backgroundColor: "color-mix(in oklch, var(--warning) 22%, transparent)" },
});

// Tints each line by its author and underlines the places where two people's text was merged. `onSpots` hears of them for the side panel.
export function lensMarks(doc: Y.Doc, ytext: Y.Text, onSpots?: (spots: MergeSpot[]) => void): Extension {
	const authors = doc.getMap<AuthorInfo>("authors");
	const plugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private gone = false;
			private readonly changed = () => queueMicrotask(() => !this.gone && this.view.dispatch({ effects: refresh.of(null) }));

			constructor(readonly view: EditorView) {
				this.decorations = this.build();
				authors.observe(this.changed);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))) this.decorations = this.build();
			}

			destroy() {
				this.gone = true;
				authors.unobserve(this.changed);
				onSpots?.([]);
			}

			private build(): DecorationSet {
				const state = this.view.state.doc;
				const ranges: Range<Decoration>[] = [];
				blameLines(ytext, authors).forEach((name, i) => {
					if (i + 1 > state.lines) return;
					ranges.push(Decoration.line({ class: "cm-lens-line", attributes: { style: `--lens:${colorOf(name)}`, title: name } }).range(state.line(i + 1).from));
				});
				const spots = mergeSpots(ytext, authors);
				for (const s of spots) {
					if (s.to > s.from && s.to <= state.length) ranges.push(Decoration.mark({ class: "cm-lens-merge", attributes: { title: `${s.authors.join(" and ")} wrote here at the same time` } }).range(s.from, s.to));
				}
				// Not during the editor's own update
				queueMicrotask(() => !this.gone && onSpots?.(spots));
				return Decoration.set(ranges, true);
			}
		},
		{ decorations: (v) => v.decorations },
	);
	return [plugin, theme];
}
