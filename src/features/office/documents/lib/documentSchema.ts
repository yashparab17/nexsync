// The document editor's schema: BlockNote's blocks and character styles, plus the two a word processor needs that it lacks: a font
// size and a font. Both are read back from the `font-size` and `font-family` of a span, so files that come in as HTML keep them.

import { BlockNoteSchema, createStyleSpec, defaultStyleSpecs } from "@blocknote/core";

import { pointsOf } from "@/features/office/documents/lib/documentFormat";

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

export const documentSchema = BlockNoteSchema.create({ styleSpecs: { ...defaultStyleSpecs, fontSize, fontFamily, textColor: colourSpec("textColor", "color"), backgroundColor: colourSpec("backgroundColor", "backgroundColor") } });
export type DocumentEditorType = typeof documentSchema.BlockNoteEditor;
