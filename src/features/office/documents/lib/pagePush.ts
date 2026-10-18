// The spacing (padding above each block; the editor's own styles force its margins to nothing) that puts each block on its page, given to ProseMirror as decorations on the blocks, nested ones too
// (a list item's sub-items each find their own page, as Word breaks a list between its items). A table broken over two pages has its
// rows from the break on moved down past the gap by an empty row put before them. (Changing the style of the blocks' elements directly
// does not work: the editor sees the change, draws the block again and drops it.) `setPushes` hands it one number of pixels per block,
// in document order, and the table breaks; `pushesOf` and `splitsOf` read back what is applied.

import { Plugin } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

export type Split = { at: number; px: number } | null;

function gapRow(cells: number, px: number) {
	const tr = document.createElement("tr");
	tr.className = "nx-row-gap";
	tr.contentEditable = "false";
	const td = document.createElement("td");
	td.colSpan = Math.max(1, cells);
	td.style.cssText = `height:${px}px;padding:0;border:none`;
	tr.appendChild(td);
	return tr;
}

interface Pushes {
	push: number[];
	split: Split[];
	// Built when the pushes change, not in `decorations`: the view asks for those on every update, and a new set each time has it
	// compare every block's decorations again
	set: DecorationSet;
}

function build(doc: PMNode, push: number[], split: Split[]): DecorationSet {
	if (!push.some((p) => p > 0) && !split.some(Boolean)) return DecorationSet.empty;
	const decos: Decoration[] = [];
	let index = 0;
	doc.descendants((node, pos) => {
		const name = node.type.name;
		if (name === "blockContainer") {
			const i = index++;
			const px = push[i];
			const cut = split[i];
			if (px > 0) decos.push(Decoration.node(pos, pos + node.nodeSize, { style: `padding-top:${px}px` }));
			if (cut) {
				// An empty row with no borders before the first row of the next page, as tall as the gap it has to cross
				let row = 0;
				node.descendants((n, p) => {
					if (n.type.name !== "tableRow") return true;
					if (row++ === cut.at) {
						const at = pos + 1 + p;
						decos.push(Decoration.widget(at, () => gapRow(n.childCount, cut.px), { side: -1, key: `nx-gap-${cut.at}-${cut.px}`, ignoreSelection: true }));
						decos.push(Decoration.node(at, at + n.nodeSize, { class: "nx-row-break" }));
					}
					return false;
				});
			}
		}
		// Only the blocks and their groups are walked, not the text inside them
		return name === "doc" || name === "blockGroup" || name === "blockContainer";
	});
	return DecorationSet.create(doc, decos);
}

export const pagePushPlugin: Plugin<Pushes> = new Plugin<Pushes>({
	state: {
		init: () => ({ push: [], split: [], set: DecorationSet.empty }),
		apply: (tr, value) => {
			const next = tr.getMeta("pagePush") as Omit<Pushes, "set"> | undefined;
			if (next) return { ...next, set: build(tr.doc, next.push, next.split) };
			// (an edit moves them along with the text until the pages are worked out again)
			return tr.docChanged ? { ...value, set: value.set.map(tr.mapping, tr.doc) } : value;
		},
	},
	props: {
		decorations: (state) => pagePushPlugin.getState(state)?.set ?? null,
	},
});

export const pushesOf = (view: EditorView): number[] => pagePushPlugin.getState(view.state)?.push ?? [];
export const splitsOf = (view: EditorView): Split[] => pagePushPlugin.getState(view.state)?.split ?? [];

// Layout works in fractions of a pixel that move by a hundredth from one measuring to the next; a change of less than a pixel is no
// change, or every new layout would be measured again, and again, without end
const near = (a: number, b: number) => Math.abs(a - b) < 1;
const same = (a: Split, b: Split) => (a === null ? b === null : b !== null && a.at === b.at && near(a.px, b.px));

export function setPushes(view: EditorView, pushes: number[], splits: Split[] = []) {
	const push = pushes.map(Math.round);
	const split = splits.map((s) => s && { at: s.at, px: Math.round(s.px) });
	const now = pagePushPlugin.getState(view.state) ?? { push: [], split: [] };
	if (now.push.length === push.length && now.push.every((p, i) => near(p, push[i])) && now.split.length === split.length && now.split.every((s, i) => same(s, split[i]))) return;
	view.dispatch(view.state.tr.setMeta("pagePush", { push, split }));
}
