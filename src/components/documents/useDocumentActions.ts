import { useCallback, useEffect, useState } from "react";

import { DEFAULT_FONT, DEFAULT_SIZE, pointsOf, stepSize, STYLES, styleOf, type StyleId } from "@/lib/documentFormat";
import { documentSchema } from "@/lib/documentSchema";

type Editor = typeof documentSchema.BlockNoteEditor;

export interface Fmt {
	bold: boolean;
	italic: boolean;
	underline: boolean;
	strike: boolean;
	font: string;
	size: number;
	color: string;
	highlight: string;
	align: "left" | "center" | "right" | "justify";
	style: StyleId;
	list: "bullet" | "number" | "check" | null;
	canNest: boolean;
	canUnnest: boolean;
	hasSelection: boolean;
}

const NONE: Fmt = { bold: false, italic: false, underline: false, strike: false, font: DEFAULT_FONT, size: DEFAULT_SIZE, color: "", highlight: "", align: "left", style: "normal", list: null, canNest: false, canUnnest: false, hasSelection: false };

type AnyBlock = { id: string; type: string; props?: Record<string, unknown>; content?: unknown; children?: AnyBlock[] };

// The blocks a command applies to: those the selection touches, or the one the caret is in
function targets(editor: Editor): AnyBlock[] {
	const sel = editor.getSelection();
	if (sel && sel.blocks.length > 0) return sel.blocks as unknown as AnyBlock[];
	return [editor.getTextCursorPosition().block as unknown as AnyBlock];
}

const LISTS = { bullet: "bulletListItem", number: "numberedListItem", check: "checkListItem" } as const;

// What the ribbon shows about the text the caret is in, kept up to date as the selection and the text change, and the things the
// ribbon does to it
export function useDocumentActions(editor: Editor | null) {
	const [fmt, setFmt] = useState<Fmt>(NONE);

	const refresh = useCallback(() => {
		if (!editor) return;
		try {
			const s = editor.getActiveStyles() as Record<string, string | boolean | undefined>;
			const block = editor.getTextCursorPosition().block as unknown as AnyBlock;
			const type = block.type;
			setFmt({
				bold: !!s.bold,
				italic: !!s.italic,
				underline: !!s.underline,
				strike: !!s.strike,
				font: typeof s.fontFamily === "string" ? s.fontFamily : DEFAULT_FONT,
				size: pointsOf(typeof s.fontSize === "string" ? s.fontSize : undefined) ?? DEFAULT_SIZE,
				color: typeof s.textColor === "string" && s.textColor !== "default" ? s.textColor : "",
				highlight: typeof s.backgroundColor === "string" && s.backgroundColor !== "default" ? s.backgroundColor : "",
				align: ((block.props?.textAlignment as Fmt["align"]) ?? "left") || "left",
				style: styleOf(block as { type: string; props?: { level?: number } }),
				list: type === "bulletListItem" ? "bullet" : type === "numberedListItem" ? "number" : type === "checkListItem" ? "check" : null,
				canNest: editor.canNestBlock(),
				canUnnest: editor.canUnnestBlock(),
				hasSelection: editor.getSelectedText().length > 0,
			});
		} catch {
			// The editor is between states (being mounted or rebuilt)
		}
	}, [editor]);

	useEffect(() => {
		if (!editor) return;
		refresh();
		const off1 = editor.onSelectionChange(refresh);
		const off2 = editor.onChange(refresh);
		return () => {
			off1?.();
			off2?.();
		};
	}, [editor, refresh]);

	// Everything below puts the caret back in the text afterwards, as clicking a ribbon button takes it away
	const done = useCallback(() => {
		editor?.focus();
		refresh();
	}, [editor, refresh]);

	const act = useCallback(
		(fn: (e: Editor) => void) => {
			if (!editor) return;
			fn(editor);
			done();
		},
		[editor, done],
	);

	return {
		fmt,
		toggle: (style: "bold" | "italic" | "underline" | "strike") => act((e) => e.toggleStyles({ [style]: true } as never)),
		setFont: (name: string) => act((e) => e.addStyles({ fontFamily: name } as never)),
		setSize: (pt: number) => act((e) => e.addStyles({ fontSize: `${pt}pt` } as never)),
		stepSize: (dir: 1 | -1) => act((e) => e.addStyles({ fontSize: `${stepSize(fmt.size, dir)}pt` } as never)),
		setColor: (hex: string) => act((e) => (hex ? e.addStyles({ textColor: `#${hex}` } as never) : e.removeStyles({ textColor: fmt.color } as never))),
		setHighlight: (hex: string) => act((e) => (hex ? e.addStyles({ backgroundColor: `#${hex}` } as never) : e.removeStyles({ backgroundColor: fmt.highlight } as never))),
		clearFormatting: () =>
			act((e) => {
				const s = e.getActiveStyles() as Record<string, unknown>;
				const present = Object.fromEntries(Object.entries(s).filter(([, v]) => v));
				if (Object.keys(present).length > 0) e.removeStyles(present as never);
				for (const b of targets(e)) e.updateBlock(b.id, { type: "paragraph", props: { textAlignment: "left" } } as never);
			}),
		align: (a: Fmt["align"]) => act((e) => targets(e).forEach((b) => e.updateBlock(b.id, { props: { textAlignment: a } } as never))),
		// A list kind switches the blocks to it, or back to plain paragraphs when they already are that kind
		list: (kind: keyof typeof LISTS) => act((e) => targets(e).forEach((b) => e.updateBlock(b.id, { type: b.type === LISTS[kind] ? "paragraph" : LISTS[kind] } as never))),
		indent: (dir: 1 | -1) => act((e) => (dir === 1 ? e.nestBlock() : e.unnestBlock())),
		style: (id: StyleId) => {
			const spec = STYLES.find((s) => s.id === id)?.block;
			if (spec) act((e) => targets(e).forEach((b) => e.updateBlock(b.id, spec as never)));
		},
		undo: () => act((e) => e.undo()),
		redo: () => act((e) => e.redo()),
		insertTable: (rows: number, cols: number) =>
			act((e) => {
				const at = e.getTextCursorPosition().block;
				e.insertBlocks([{ type: "table", content: { type: "tableContent", rows: Array.from({ length: rows }, () => ({ cells: Array.from({ length: cols }, () => "") })) } } as never], at, "after");
			}),
		insertImage: (url: string, name: string) =>
			act((e) => {
				const at = e.getTextCursorPosition().block;
				e.insertBlocks([{ type: "image", props: { url, name, caption: "", previewWidth: 420 } } as never], at, "after");
			}),
		insertLink: (url: string) => act((e) => e.createLink(url)),
		insertText: (text: string) => act((e) => e.insertInlineContent([text])),
		undoable: () => !!editor,
	};
}
