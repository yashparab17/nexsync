// The spacing (padding above each block; the editor's own styles force its margins to nothing) that puts each block on its page, given to ProseMirror as decorations on the top-level blocks. (Changing the style of the
// blocks' elements directly does not work: the editor sees the change, draws the block again and drops it.) `setPushes` hands it one number
// of pixels per top-level block; `pushesOf` reads back what is applied.

import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

export const pagePushPlugin = new Plugin<number[]>({
	state: {
		init: () => [],
		apply: (tr, value) => (tr.getMeta("pagePush") as number[] | undefined) ?? value,
	},
	props: {
		decorations(state) {
			const pushes = pagePushPlugin.getState(state) ?? [];
			if (!pushes.some((p) => p > 0)) return null;
			const group = state.doc.firstChild;
			if (!group) return null;
			const decos: Decoration[] = [];
			group.forEach((node, offset, index) => {
				const px = pushes[index];
				if (px > 0) decos.push(Decoration.node(1 + offset, 1 + offset + node.nodeSize, { style: `padding-top:${px}px` }));
			});
			return DecorationSet.create(state.doc, decos);
		},
	},
});

export const pushesOf = (view: EditorView): number[] => pagePushPlugin.getState(view.state) ?? [];

export function setPushes(view: EditorView, pushes: number[]) {
	const now = pushesOf(view);
	if (now.length === pushes.length && now.every((p, i) => p === pushes[i])) return;
	view.dispatch(view.state.tr.setMeta("pagePush", pushes).setMeta("addToHistory", false));
}
