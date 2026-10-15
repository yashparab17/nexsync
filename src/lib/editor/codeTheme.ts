// How code looks in the editor. The surface comes from the app theme's colours; the syntax colours come from the --syn-*
// variables, which follow the theme or a chosen scheme (see codeSchemes.ts), so changing either restyles open editors
// without rebuilding them.

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const syn = (name: string) => `var(--syn-${name})`;

const highlight = HighlightStyle.define([
	{ tag: [t.keyword, t.controlKeyword, t.modifier, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.self], color: syn("keyword") },
	{ tag: [t.string, t.special(t.string), t.character, t.regexp], color: syn("string") },
	{ tag: [t.number, t.integer, t.float], color: syn("number") },
	{ tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName)), t.macroName, t.attributeName], color: syn("function") },
	{ tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: syn("type") },
	{ tag: [t.variableName, t.propertyName, t.definition(t.variableName), t.labelName, t.content], color: syn("variable") },
	{ tag: [t.tagName, t.angleBracket, t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: syn("tag") },
	{ tag: [t.bool, t.null, t.atom, t.constant(t.variableName), t.standard(t.variableName)], color: syn("constant") },
	{ tag: [t.link, t.url], color: syn("function"), textDecoration: "underline" },
	{ tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta, t.quote], color: syn("comment"), fontStyle: "italic" },
	{ tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator, t.compareOperator, t.logicOperator, t.arithmeticOperator], color: syn("operator") },
	{ tag: t.strong, fontWeight: "bold" },
	{ tag: t.emphasis, fontStyle: "italic" },
	{ tag: t.strikethrough, textDecoration: "line-through" },
	{ tag: t.invalid, color: "var(--destructive)" },
]);

export const codeLook = (dark: boolean): Extension[] => [
	EditorView.theme(
		{
			"&": { color: "var(--foreground)" },
			".cm-content": { caretColor: "var(--primary)" },
			".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--primary)" },
			"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { background: "color-mix(in oklch, var(--primary) 28%, transparent)" },
			".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--foreground) 6%, transparent)" },
			".cm-activeLineGutter": { backgroundColor: "color-mix(in oklch, var(--foreground) 8%, transparent)", color: "var(--foreground)" },
			".cm-gutters": { color: "var(--muted-foreground)" },
			".cm-foldPlaceholder": { backgroundColor: "var(--muted)", color: "var(--muted-foreground)", border: "none" },
			"&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": { backgroundColor: "color-mix(in oklch, var(--primary) 25%, transparent)", outline: "1px solid color-mix(in oklch, var(--primary) 55%, transparent)" },
			".cm-searchMatch": { backgroundColor: "color-mix(in oklch, var(--warning) 30%, transparent)" },
			".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in oklch, var(--warning) 55%, transparent)" },
			".cm-tooltip": { backgroundColor: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)" },
			".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "color-mix(in oklch, var(--primary) 22%, transparent)", color: "var(--foreground)" },
			".cm-panels": { backgroundColor: "var(--card)", color: "var(--foreground)" },
			".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
			".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
		},
		{ dark },
	),
	syntaxHighlighting(highlight),
];
