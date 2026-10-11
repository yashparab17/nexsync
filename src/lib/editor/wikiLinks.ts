// CodeMirror support for [[note links]]: they are underlined, and Ctrl or Cmd+click opens the note

import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

import { linkAt } from "@/lib/notes/links";

const matcher = new MatchDecorator({
	regexp: /\[\[[^\]\n]+\]\]/g,
	decoration: Decoration.mark({ class: "cm-wikilink" }),
});

export function wikiLinks(onOpen: (target: string) => void) {
	return [
		ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;
				constructor(view: EditorView) {
					this.decorations = matcher.createDeco(view);
				}
				update(update: ViewUpdate) {
					this.decorations = matcher.updateDeco(update, this.decorations);
				}
			},
			{ decorations: (plugin) => plugin.decorations },
		),
		EditorView.domEventHandlers({
			mousedown(event, view) {
				if (!(event.ctrlKey || event.metaKey)) return false;
				const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
				if (pos == null) return false;
				const line = view.state.doc.lineAt(pos);
				const target = linkAt(line.text, pos - line.from);
				if (!target) return false;
				event.preventDefault();
				onOpen(target);
				return true;
			},
		}),
		EditorView.baseTheme({ ".cm-wikilink": { color: "var(--info)", textDecoration: "underline", cursor: "pointer" } }),
	];
}
