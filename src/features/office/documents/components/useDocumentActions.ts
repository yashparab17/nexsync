import { TableHandlesExtension } from "@blocknote/core";
import { useCallback, useEffect, useState } from "react";
import type * as Y from "yjs";

import { changeCase, type CaseKind, DEFAULT_FONT, DEFAULT_SIZE, HIGHLIGHTS, pointsOf, stepSize, STYLES, styleOf, type StyleId } from "@/features/office/documents/lib/documentFormat";
import { headingsOf, textOfBlocks, type BlockLike } from "@/features/office/documents/lib/documentFind";
import { equationText, indexEntries, withFormula, type Formula } from "@/features/office/documents/lib/documentReferences";
import { cropImage, drawShape, type CropMode, type ShapeKind } from "@/features/office/documents/lib/documentObjects";
import { formatSection, NEW_SECTION, sectionStart, type SectionSpec } from "@/features/office/documents/lib/documentSections";
import { nextNoteId, noteValue, REF_TEXT, type NoteDef } from "@/features/office/documents/lib/documentNotes";
import { applyToRuns, blockPropsOf, fromCaret, idFromName, isBuiltInWordId, WORD_ID, type StyleDef } from "@/features/office/documents/lib/documentStyles";
import { nextCaption, TOC, TOC_TITLE, sortTable, tocBlocks, type TableContent } from "@/features/office/documents/lib/documentTools";
import { documentSchema } from "@/features/office/documents/lib/documentSchema";

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
	// A look of the gallery (normal, h1...) or the id of a style of the document
	style: string;
	list: "bullet" | "number" | "check" | null;
	canNest: boolean;
	canUnnest: boolean;
	hasSelection: boolean;
	inTable: boolean;
	headerRow: boolean;
	inPicture: boolean;
	// The page set-up of the section the caret is in when a break started it, else empty (the first section, which the page set-up is)
	section: string;
}

const NONE: Fmt = { bold: false, italic: false, underline: false, strike: false, font: DEFAULT_FONT, size: DEFAULT_SIZE, color: "", highlight: "", align: "left", style: "normal", list: null, canNest: false, canUnnest: false, hasSelection: false, inTable: false, headerRow: false, inPicture: false, section: "" };

type AnyBlock = { id: string; type: string; props?: Record<string, unknown>; content?: unknown; children?: AnyBlock[] };

// The blocks a command applies to: those the selection touches, or the one the caret is in
function targets(editor: Editor): AnyBlock[] {
	const sel = editor.getSelection();
	if (sel && sel.blocks.length > 0) return sel.blocks as unknown as AnyBlock[];
	return [editor.getTextCursorPosition().block as unknown as AnyBlock];
}

// A style's definition (font, size, colour, bold, italic) put on the text of a block
function paint(e: Editor, b: AnyBlock, def: Record<string, unknown>) {
	if (!Array.isArray(b.content) || Object.keys(def).length === 0) return;
	e.updateBlock(b.id, { content: (b.content as { type?: string; styles?: object }[]).map((r) => (r.type === "text" ? { ...r, styles: { ...r.styles, ...def } } : r)) } as never);
}

// The look of a style of the document put on the text of a block
function restyle(e: Editor, b: AnyBlock, def: StyleDef) {
	if (!Array.isArray(b.content)) return;
	e.updateBlock(b.id, { content: (b.content as { type?: string; styles?: Record<string, unknown> }[]).map((r) => (r.type === "text" ? { ...r, styles: applyToRuns(r.styles ?? {}, def) } : r)) } as never);
}

// The gallery entry the block is in: one of the document's own styles when it has its id, otherwise the look its type gives
function styleName(block: { type: string; props?: { level?: number; styleId?: unknown } }, sheet?: Y.Map<StyleDef>): string {
	const id = block.props?.styleId;
	return typeof id === "string" && id && sheet?.has(id) && !isBuiltInWordId(id) ? id : styleOf(block);
}

const LISTS = { bullet: "bulletListItem", number: "numberedListItem", check: "checkListItem" } as const;

// What the ribbon shows about the text the caret is in, kept up to date as the selection and the text change, and the things the
// ribbon does to it
export function useDocumentActions(editor: Editor | null, defs?: Y.Map<Record<string, unknown>>, sheet?: Y.Map<StyleDef>, notes?: Y.Map<NoteDef>) {
	const [fmt, setFmt] = useState<Fmt>(NONE);
	// The look picked up by Format Painter, waiting for a selection to paint
	const [painter, setPainter] = useState<Record<string, unknown> | null>(null);

	const refresh = useCallback(() => {
		if (!editor) return;
		try {
			const s = editor.getActiveStyles() as Record<string, string | boolean | undefined>;
			const block = editor.getTextCursorPosition().block as unknown as AnyBlock;
			const type = block.type;
			const next: Fmt = {
				bold: !!s.bold,
				italic: !!s.italic,
				underline: !!s.underline,
				strike: !!s.strike,
				font: typeof s.fontFamily === "string" ? s.fontFamily : DEFAULT_FONT,
				size: pointsOf(typeof s.fontSize === "string" ? s.fontSize : undefined) ?? DEFAULT_SIZE,
				color: typeof s.textColor === "string" && s.textColor !== "default" ? s.textColor : "",
				highlight: typeof s.backgroundColor === "string" && s.backgroundColor !== "default" ? s.backgroundColor : "",
				align: ((block.props?.textAlignment as Fmt["align"]) ?? "left") || "left",
				style: styleName(block as { type: string; props?: { level?: number; styleId?: unknown } }, sheet),
				list: type === "bulletListItem" ? "bullet" : type === "numberedListItem" ? "number" : type === "checkListItem" ? "check" : null,
				canNest: editor.canNestBlock(),
				canUnnest: editor.canUnnestBlock(),
				hasSelection: editor.getSelectedText().length > 0,
				inTable: type === "table",
				inPicture: type === "image",
				section: (() => {
					const found = sectionStart(editor.document as unknown as AnyBlock[], block.id);
					return found ? formatSection(found.spec) : "";
				})(),
				headerRow: type === "table" && ((block.content as { headerRows?: number } | undefined)?.headerRows ?? 0) > 0,
			};
			// Unchanged (most keystrokes): the same object, so the page around the text is not drawn again for nothing
			setFmt((cur) => ((Object.keys(next) as (keyof Fmt)[]).every((k) => cur[k] === next[k]) ? cur : next));
		} catch {
			// The editor is between states (being mounted or rebuilt)
		}
	}, [editor, sheet]);

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
		// A look of the gallery, or a style of the document: its id goes on the paragraph and its look on the text
		style: (id: string) => {
			const own = sheet?.get(id);
			if (own && !isBuiltInWordId(id)) {
				act((e) =>
					targets(e).forEach((b) => {
						e.updateBlock(b.id, { props: blockPropsOf(own) } as never);
						restyle(e, e.getBlock(b.id) as unknown as AnyBlock, own);
					}),
				);
				return;
			}
			const spec = STYLES.find((s) => s.id === id)?.block as { type: string; props?: object } | undefined;
			if (spec)
				act((e) => {
					targets(e).forEach((b) => e.updateBlock(b.id, { ...spec, props: { ...spec.props, styleId: WORD_ID[id as StyleId] } } as never));
					const def = defs?.get(id);
					if (def) targets(e).forEach((b) => paint(e, e.getBlock(b.id) as unknown as AnyBlock, def));
				});
		},
		// A new style of the document from the look at the caret, given to the paragraphs the selection touches
		createStyle: (name: string) =>
			act((e) => {
				if (!sheet || !name.trim()) return;
				const block = e.getTextCursorPosition().block as unknown as AnyBlock;
				const id = idFromName(name, sheet.keys());
				sheet.set(id, fromCaret(name, id, { font: fmt.font, size: fmt.size, bold: fmt.bold, italic: fmt.italic, underline: fmt.underline, color: fmt.color }, block.props ?? {}));
				targets(e).forEach((b) => e.updateBlock(b.id, { props: { styleId: id } } as never));
			}),
		undo: () => act((e) => e.undo()),
		redo: () => act((e) => e.redo()),
		insertTable: (rows: number, cols: number) =>
			act((e) => {
				const at = e.getTextCursorPosition().block;
				e.insertBlocks([{ type: "table", content: { type: "tableContent", rows: Array.from({ length: rows }, () => ({ cells: Array.from({ length: cols }, () => "") })) } } as never], at, "after");
			}),
		// The first row of the table the caret is in becomes a header row, or stops being one
		toggleHeaderRow: () =>
			act((e) => {
				const b = e.getTextCursorPosition().block as unknown as AnyBlock;
				const c = b.content as { type: "tableContent"; headerRows?: number } | undefined;
				if (b.type === "table" && c) e.updateBlock(b.id, { content: { ...c, headerRows: c.headerRows ? undefined : 1 } } as never);
			}),
		// Merge the selected cells (drag across them), split a merged cell, add or remove the row or column the caret is in
		table: (op: "merge" | "split" | "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "delRow" | "delCol") =>
			act((e) => {
				const t = e.getExtension(TableHandlesExtension);
				const at = t?.getCellSelection()?.from;
				if (!t || !at) return;
				if (op === "merge") t.mergeCells();
				else if (op === "split") t.splitCell();
				else if (op === "delRow") t.removeRowOrColumn(at.row, "row");
				else if (op === "delCol") t.removeRowOrColumn(at.col, "column");
				else if (op === "rowAbove" || op === "rowBelow") t.addRowOrColumn(at.row, { orientation: "row", side: op === "rowAbove" ? "above" : "below" });
				else t.addRowOrColumn(at.col, { orientation: "column", side: op === "colLeft" ? "left" : "right" });
			}),
		// Sort the table the caret is in by the column the caret is in, below its header rows
		sortTable: (asc: boolean) =>
			act((e) => {
				const b = e.getTextCursorPosition().block as unknown as AnyBlock;
				const col = e.getExtension(TableHandlesExtension)?.getCellSelection()?.from.col;
				if (b.type === "table" && col !== undefined) e.updateBlock(b.id, { content: sortTable(b.content as TableContent, col, asc) } as never);
			}),
		// A table of contents from the headings as they are now (a copy; insert it again after the headings change)
		insertToc: () =>
			act((e) => {
				const top = e.document as unknown as AnyBlock[];
				const made = tocBlocks(headingsOf(top as unknown as BlockLike[])) as never[];
				const old = top.filter((b) => b.props?.styleId === TOC_TITLE || b.props?.styleId === TOC);
				// Pressed again, it replaces the contents already there
				if (old.length > 0) {
					e.insertBlocks(made, old[0].id, "before");
					e.removeBlocks(old.map((b) => b.id));
				} else e.insertBlocks(made, e.getTextCursorPosition().block, "after");
			}),
		insertCaption: (label: string) =>
			act((e) => {
				const texts = (e.document as unknown as BlockLike[]).map((b) => textOfBlocks([{ ...b, children: [] }]).trim());
				const at = e.getTextCursorPosition().block;
				e.insertBlocks([{ type: "paragraph", props: { textAlignment: "center" }, content: [{ type: "text", text: nextCaption(texts, label), styles: { italic: true } }] } as never], at, "after");
			}),
		// A formula in the cell the caret is in: the sum or average of the numbers above it or to its left
		tableFormula: (kind: Formula) =>
			act((e) => {
				const b = e.getTextCursorPosition().block as unknown as AnyBlock;
				const at = e.getExtension(TableHandlesExtension)?.getCellSelection()?.from;
				const next = b.type === "table" && at ? withFormula(b.content as TableContent, at.row, at.col, kind) : null;
				if (next) e.updateBlock(b.id, { content: next } as never);
			}),
		// A new page starts here: an empty paragraph that begins one
		pageBreak: () =>
			act((e) => {
				const at = e.getTextCursorPosition().block;
				e.insertBlocks([{ type: "paragraph", props: { pageBreakBefore: true }, content: [] } as never], at, "after");
			}),
		// A new section starts here: an empty paragraph that begins it, on a new page or continuing the page
		sectionBreak: (continuous: boolean) =>
			act((e) => {
				const at = e.getTextCursorPosition().block;
				e.insertBlocks([{ type: "paragraph", props: { sectionBreak: formatSection({ ...NEW_SECTION, continuous }) }, content: [] } as never], at, "after");
				// The caret goes into the new section, so its set-up is what the ribbon shows
				const first = e.getNextBlock(at);
				if (first) e.setTextCursorPosition(first, "start");
			}),
		// Changes the page set-up of the section the caret is in (a section a break started)
		setSection: (change: Partial<SectionSpec>) =>
			act((e) => {
				const found = sectionStart(e.document as unknown as AnyBlock[], (e.getTextCursorPosition().block as unknown as AnyBlock).id);
				if (found) e.updateBlock(found.block.id, { props: { sectionBreak: formatSection({ ...found.spec, ...change }) } } as never);
			}),
		// Takes the break away: the section joins the one before it
		removeSection: () =>
			act((e) => {
				const found = sectionStart(e.document as unknown as AnyBlock[], (e.getTextCursorPosition().block as unknown as AnyBlock).id);
				if (found) e.updateBlock(found.block.id, { props: { sectionBreak: "" } } as never);
			}),
		// A box for text: a table of one cell
		textBox: () =>
			act((e) => {
				const at = e.getTextCursorPosition().block;
				e.insertBlocks([{ type: "table", content: { type: "tableContent", rows: [{ cells: ["Text box"] }] } } as never], at, "after");
			}),
		insertEquation: (src: string) => act((e) => e.insertInlineContent([{ type: "text", text: equationText(src), styles: { italic: true } }] as never)),
		// Text in a grey box that a teammate replaces
		formField: () => act((e) => e.insertInlineContent([{ type: "text", text: "[Click here to enter text]", styles: { backgroundColor: "#d9d9d9" } }] as never)),
		// The picture the caret is in: its width, alignment and the description for people who cannot see it
		picture: (change: { width?: number; align?: "left" | "center" | "right"; alt?: string; wrap?: "none" | "left" | "right" }) =>
			act((e) => {
				const b = e.getTextCursorPosition().block as unknown as AnyBlock;
				if (b.type !== "image") return;
				e.updateBlock(b.id, { props: { ...(change.width ? { previewWidth: change.width } : {}), ...(change.align ? { textAlignment: change.align } : {}), ...(change.alt !== undefined ? { name: change.alt } : {}), ...(change.wrap ? { wrap: change.wrap } : {}) } } as never);
			}),
		// A footnote (or, with `end`, an endnote): a reference where the caret is, numbered by its place in the text, and its words kept beside the
		// text; in the file it is a real note
		footnote: (words: string, end = false) =>
			act((e) => {
				if (!notes) return;
				const id = nextNoteId([...notes.keys()].map(Number));
				notes.set(String(id), { end, text: words.trim() });
				e.insertInlineContent([{ type: "text", text: REF_TEXT, styles: { note: noteValue(end, id) } }] as never);
			}),
		// New words for a note
		editNote: (id: number, text: string) => {
			const n = notes?.get(String(id));
			if (n && notes) notes.set(String(id), { ...n, text });
		},
		// Marks the words as an index entry (a highlight, which the index then collects)
		markEntry: () => act((e) => e.addStyles({ backgroundColor: `#${HIGHLIGHTS[5]}` } as never)),
		insertIndex: () =>
			act((e) => {
				const words = indexEntries(e.document as never);
				const at = e.getTextCursorPosition().block;
				e.insertBlocks([{ type: "heading", props: { level: 1 }, content: "Index" }, ...(words.length ? words.map((w) => ({ type: "paragraph", content: w })) : [{ type: "paragraph", content: "No entries yet. Select words and choose Mark Entry." }])] as never, at, "after");
			}),
		// A mark for the words other parts of the document refer to
		crossRef: (text: string) => act((e) => e.insertInlineContent([text])),
		// Takes the look at the caret as the definition of the style the caret is in, and gives it to every block of that style
		updateStyle: () =>
			act((e) => {
				const block = e.getTextCursorPosition().block as unknown as AnyBlock;
				const look = { font: fmt.font, size: fmt.size, bold: fmt.bold, italic: fmt.italic, underline: fmt.underline, color: fmt.color };
				const own = sheet?.get(fmt.style);
				// A style of the document (of the file, or made here): its definition becomes the look at the caret, for every paragraph that has it
				if (sheet && own && !isBuiltInWordId(fmt.style)) {
					const def: StyleDef = { ...fromCaret(own.name, own.id, look, block.props ?? {}), basedOn: own.basedOn };
					sheet.set(own.id, def);
					const walkOwn = (list: AnyBlock[]) => {
						for (const b of list) {
							if (b.props?.styleId === own.id) {
								e.updateBlock(b.id, { props: blockPropsOf(def) } as never);
								restyle(e, e.getBlock(b.id) as unknown as AnyBlock, def);
							}
							if (b.children?.length) walkOwn(b.children);
						}
					};
					walkOwn(e.document as unknown as AnyBlock[]);
					return;
				}
				// A look of the gallery that is a Word style (Heading 1...) is changed in the file too
				const word = WORD_ID[fmt.style as StyleId];
				if (sheet && word) sheet.set(word, fromCaret(STYLES.find((s) => s.id === fmt.style)?.label ?? word, word, look, block.props ?? {}));
				if (!defs) return;
				const s = e.getActiveStyles() as Record<string, unknown>;
				const def = Object.fromEntries(["fontFamily", "fontSize", "textColor", "bold", "italic"].filter((k) => s[k]).map((k) => [k, s[k]]));
				defs.set(fmt.style, def);
				const walk = (list: AnyBlock[]) => {
					for (const b of list) {
						if (styleOf(b as { type: string; props?: { level?: number } }) === fmt.style) paint(e, b, def);
						if (b.children?.length) walk(b.children);
					}
				};
				walk(e.document as unknown as AnyBlock[]);
			}),
		// Text that stands for a value and can be brought up to date with Update Fields
		insertField: (kind: string, value: string) => act((e) => e.insertInlineContent([{ type: "text", text: value, styles: { field: kind } }] as never)),
		updateFields: (values: Record<string, string>) =>
			act((e) => {
				let n = 0;
				const walk = (list: AnyBlock[]) => {
					for (const b of list) {
						if (Array.isArray(b.content) && (b.content as { styles?: { field?: string } }[]).some((r) => r.styles?.field)) {
							const next = (b.content as { type?: string; text?: string; styles?: { field?: string } }[]).map((r) => (r.styles?.field && values[r.styles.field] !== undefined && r.text !== values[r.styles.field] ? (n++, { ...r, text: values[r.styles.field] }) : r));
							e.updateBlock(b.id, { content: next } as never);
						}
						if (b.children?.length) walk(b.children);
					}
				};
				walk(e.document as unknown as AnyBlock[]);
				return n;
			}),
		// A shape drawn as a picture, after the block the caret is in
		insertShape: (kind: ShapeKind, color: string) =>
			act((e) => {
				const url = drawShape(kind, color);
				if (url) e.insertBlocks([{ type: "image", props: { url, name: kind, caption: "", previewWidth: kind === "line" ? 240 : 200 } } as never], e.getTextCursorPosition().block, "after");
			}),
		// The picture the caret is in, cropped
		cropPicture: async (mode: CropMode) => {
			if (!editor) return;
			const b = editor.getTextCursorPosition().block as unknown as AnyBlock;
			const url = (b.props as { url?: string } | undefined)?.url;
			if (b.type !== "image" || !url) return;
			const next = await cropImage(url, mode);
			if (next) editor.updateBlock(b.id, { props: { url: next } } as never);
			done();
		},
		insertImage: (url: string, name: string) =>
			act((e) => {
				const at = e.getTextCursorPosition().block;
				e.insertBlocks([{ type: "image", props: { url, name, caption: "", previewWidth: 420 } } as never], at, "after");
			}),
		insertLink: (url: string) => act((e) => e.createLink(url)),
		insertText: (text: string) => act((e) => e.insertInlineContent([text])),
		changeCase: (kind: CaseKind) =>
			act((e) => {
				const text = e.getSelectedText();
				if (text) e.insertInlineContent([changeCase(text, kind)]);
			}),
		// First press picks up the look at the caret, the next press paints it onto the selection
		painter,
		formatPainter: () =>
			act((e) => {
				if (!painter) return setPainter(Object.fromEntries(Object.entries(e.getActiveStyles() as Record<string, unknown>).filter(([, v]) => v)));
				if (e.getSelectedText()) {
					const old = Object.fromEntries(Object.entries(e.getActiveStyles() as Record<string, unknown>).filter(([, v]) => v));
					if (Object.keys(old).length > 0) e.removeStyles(old as never);
					if (Object.keys(painter).length > 0) e.addStyles(painter as never);
				}
				setPainter(null);
			}),
		undoable: () => !!editor,
	};
}
