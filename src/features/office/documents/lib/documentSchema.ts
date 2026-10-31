// The document editor's schema: BlockNote's blocks and character styles, plus what a word processor needs that they lack. Characters
// get a font size and a font (read back from the `font-size` and `font-family` of a span, so text pasted as HTML keeps them). Text
// blocks get a Word paragraph's properties (see `WORD_PROPS`), stored with the text, so they are shared, undone and copied with it.

import { BlockNoteSchema, createStyleSpec, defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";

import { colorOf } from "@/lib/collabColor";
import { pointsOf } from "@/features/office/documents/lib/documentFormat";
import { lineFactor } from "@/features/office/documents/lib/fontMetrics";

const fontSize = createStyleSpec(
	{ type: "fontSize", propSchema: "string" },
	{
		render: (value) => {
			const dom = document.createElement("span");
			dom.style.fontSize = /pt$/.test(value) ? value : `${value}pt`;
			return { dom, contentDOM: dom };
		},
		toExternalHTML: (value) => {
			const dom = document.createElement("span");
			dom.style.fontSize = /pt$/.test(value) ? value : `${value}pt`;
			return { dom, contentDOM: dom };
		},
		parse: (el) => {
			const raw = el.style.fontSize;
			if (!raw) return undefined;
			const pt = raw.endsWith("px") ? Number.parseFloat(raw) * 0.75 : pointsOf(raw);
			return pt && pt > 0 ? `${Math.round(pt * 10) / 10}pt` : undefined;
		},
	},
);

const fontFamily = createStyleSpec(
	{ type: "fontFamily", propSchema: "string" },
	{
		render: (value) => {
			const dom = document.createElement("span");
			dom.style.fontFamily = value;
			// The font's own line height, which the page draws its lines from (see `fontMetrics`)
			dom.style.setProperty("--nx-lf", String(lineFactor(value)));
			return { dom, contentDOM: dom };
		},
		toExternalHTML: (value) => {
			const dom = document.createElement("span");
			dom.style.fontFamily = value;
			return { dom, contentDOM: dom };
		},
		parse: (el) => el.style.fontFamily?.split(",")[0]?.replace(/["']/g, "").trim() || undefined,
	},
);

// A field: text that stands for a value (the title, the page count, today's date) and is brought up to date on request. The value of
// the style is the field's kind; the file gets the plain text.
const field = createStyleSpec(
	{ type: "field", propSchema: "string" },
	{
		render: (value) => {
			const dom = document.createElement("span");
			dom.dataset.field = value;
			dom.title = `Field: ${value}`;
			return { dom, contentDOM: dom };
		},
		toExternalHTML: () => {
			const dom = document.createElement("span");
			return { dom, contentDOM: dom };
		},
		parse: () => undefined,
	},
);

// A reference to a footnote or an endnote: one character whose value is the kind and number of the note (see `documentNotes`). The page
// draws its number from a counter; the file gets a real reference to a real note.
const note = createStyleSpec(
	{ type: "note", propSchema: "string" },
	{
		render: (value) => {
			const dom = document.createElement("span");
			dom.dataset.note = value;
			dom.className = value.startsWith("e") ? "doc-note doc-endnote" : "doc-note";
			return { dom, contentDOM: dom };
		},
		toExternalHTML: (value) => {
			const dom = document.createElement("span");
			dom.dataset.note = value;
			return { dom, contentDOM: dom };
		},
		parse: (el) => el.dataset.note || undefined,
	},
);

// Text in a character style: one mark whose value is the style's id; the look of the style is put on the text as marks of its own, the way every
// look is held in the editor. In the file it is a run in that character style.
const charStyle = createStyleSpec(
	{ type: "charStyle", propSchema: "string" },
	{
		render: (value) => {
			const dom = document.createElement("span");
			dom.dataset.charStyle = value;
			return { dom, contentDOM: dom };
		},
		toExternalHTML: (value) => {
			const dom = document.createElement("span");
			dom.dataset.charStyle = value;
			return { dom, contentDOM: dom };
		},
		parse: (el) => el.dataset.charStyle || undefined,
	},
);

// The table style a table is in: a mark on the text of its first cell (a table has no property of its own in the editor), whose value is the
// style's id. In the file it is the table's style.
const tableStyleMark = createStyleSpec(
	{ type: "tableStyle", propSchema: "string" },
	{
		render: (value) => {
			const dom = document.createElement("span");
			dom.dataset.tableStyle = value;
			return { dom, contentDOM: dom };
		},
		toExternalHTML: (value) => {
			const dom = document.createElement("span");
			dom.dataset.tableStyle = value;
			return { dom, contentDOM: dom };
		},
		parse: (el) => el.dataset.tableStyle || undefined,
	},
);

// A tracked change: text somebody inserted or deleted while suggesting, and who and when ("author|date"). It stays in the text,
// drawn in colour, until it is accepted or rejected (see `documentReview`). In the file it is Word's w:ins or w:del.
function change(type: "insertion" | "deletion") {
	const tag = type === "insertion" ? "ins" : "del";
	// In the editor each person's changes are in their own colour (the one their cursor has); the file gets the plain element
	const draw = (value: string, own = true) => {
		const i = value.indexOf("|");
		const dom = document.createElement(tag);
		dom.className = `doc-${tag}`;
		dom.dataset.author = i < 0 ? value : value.slice(0, i);
		dom.dataset.date = i < 0 ? "" : value.slice(i + 1);
		if (own && dom.dataset.author) dom.style.color = colorOf(dom.dataset.author);
		dom.title = `${type === "insertion" ? "Inserted" : "Deleted"} by ${dom.dataset.author}`;
		return { dom, contentDOM: dom };
	};
	return createStyleSpec(
		{ type, propSchema: "string" },
		{
			render: (value) => draw(value),
			toExternalHTML: (value) => draw(value, false),
			parse: (el) => (el.tagName === tag.toUpperCase() ? `${el.dataset.author ?? ""}|${el.dataset.date ?? ""}` : undefined),
		},
	);
}

// BlockNote's own colours only know its palette names, and draw nothing for a hex such as #0F4761 (what a Word file or the colour
// picker gives). These take any CSS colour, keep it as #rrggbb, and draw it.
const hexOf = (css: string): string | undefined => {
	const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(css.trim());
	if (m) return `#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`;
	return /^#[0-9a-f]{6}$/i.test(css.trim()) ? css.trim().toLowerCase() : undefined;
};

function colourSpec(type: "textColor" | "backgroundColor", prop: "color" | "backgroundColor") {
	const draw = (value: string) => {
		const dom = document.createElement("span");
		if (value && value !== "default") dom.style[prop] = value;
		return { dom, contentDOM: dom };
	};
	return createStyleSpec(
		{ type, propSchema: "string" },
		{
			render: draw,
			toExternalHTML: draw,
			parse: (el) => {
				const raw = el.style[prop];
				return raw ? hexOf(raw) : undefined;
			},
		},
	);
}

// A Word paragraph's properties, in points. -1 (spacing) and 0 (line spacing) mean "not set": the editor's own spacing then.
export const WORD_PROPS = {
	spaceBefore: { default: -1 },
	spaceAfter: { default: -1 },
	// A multiple of single spacing, or (negative) exactly that many points
	lineSpacing: { default: 0 },
	indentLeft: { default: 0 },
	indentRight: { default: 0 },
	// Negative: a hanging indent
	indentFirst: { default: 0 },
	keepNext: { default: false },
	keepLines: { default: false },
	widowControl: { default: true },
	pageBreakBefore: { default: false },
	// A paragraph that starts a section: its page set-up (see `documentSections`)
	sectionBreak: { default: "" },
	// How the text of the section this paragraph starts sits on its page: c(entre), b(ottom), j(ustify)
	sectionVAlign: { default: "" },
	// What follows the paragraph's one tab sits at the right edge (a right tab stop: a contents line)
	tabRight: { default: false },
	// The paragraph mark's font and size: an empty paragraph's line, and the least any of its lines is
	markFont: { default: "" },
	markSize: { default: 0 },
	// A Word list: its id, level and label (numbered again as the list changes, see `wordLayout`)
	numId: { default: 0 },
	ilvl: { default: 0 },
	listLabel: { default: "" },
	// A picture's line goes on below it by its font's descent (points), as an inline picture's line does in Word
	descent: { default: 0 },
	styleId: { default: "" },
} as const;

type Spec = { config: { propSchema: Record<string, unknown> } };
const withWordProps = <T extends Spec>(spec: T): T => ({ ...spec, config: { ...spec.config, propSchema: { ...spec.config.propSchema, ...WORD_PROPS } } }) as T;

const blockSpecs = {
	...defaultBlockSpecs,
	paragraph: withWordProps(defaultBlockSpecs.paragraph),
	heading: withWordProps(defaultBlockSpecs.heading),
	bulletListItem: withWordProps(defaultBlockSpecs.bulletListItem),
	numberedListItem: withWordProps(defaultBlockSpecs.numberedListItem),
	checkListItem: withWordProps(defaultBlockSpecs.checkListItem),
	// A picture also says whether text runs round it: none, left (the picture on the left) or right
	image: ((s) => ({ ...s, config: { ...s.config, propSchema: { ...s.config.propSchema, wrap: { default: "none" } } } }) as typeof s)(withWordProps(defaultBlockSpecs.image)),
};

// The font goes before the size, so a run's size is drawn inside its font: its line is then as tall as that font at that size, as in Word
export const documentSchema = BlockNoteSchema.create({ blockSpecs, styleSpecs: { ...defaultStyleSpecs, field, note, charStyle, tableStyle: tableStyleMark, insertion: change("insertion"), deletion: change("deletion"), fontFamily, fontSize, textColor: colourSpec("textColor", "color"), backgroundColor: colourSpec("backgroundColor", "backgroundColor") } });
export type DocumentEditorType = typeof documentSchema.BlockNoteEditor;
