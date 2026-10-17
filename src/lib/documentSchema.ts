// The document editor's schema: BlockNote's blocks and character styles, plus the two a word processor needs that it lacks: a font
// size and a font. Both are read back from the `font-size` and `font-family` of a span, so files that come in as HTML keep them.

import { BlockNoteSchema, createStyleSpec, defaultStyleSpecs } from "@blocknote/core";

import { pointsOf } from "@/lib/documentFormat";

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

export const documentSchema = BlockNoteSchema.create({ styleSpecs: { ...defaultStyleSpecs, fontSize, fontFamily } });
export type DocumentEditorType = typeof documentSchema.BlockNoteEditor;
