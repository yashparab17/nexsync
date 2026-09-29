// Syntax checking from the Lezer parse tree, used for problem markers and to warn when a merge breaks code

import { syntaxTree, type LanguageSupport } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";

// Parsing very large files on every remote change would stall typing
const MAX_CHECK_LENGTH = 500_000;

// Positions of syntax errors in the current parse tree, capped so a broken file does not flood the gutter
export function errorRanges(state: EditorState, limit = 50): { from: number; to: number }[] {
	const found: { from: number; to: number }[] = [];
	syntaxTree(state).iterate({
		enter(node) {
			if (found.length >= limit) return false;
			if (node.type.isError) found.push({ from: node.from, to: node.to });
			return undefined;
		},
	});
	return found;
}

// Problem markers for the editor; languages without an error-reporting grammar simply show none
export const syntaxLinter = linter(
	(view): Diagnostic[] =>
		errorRanges(view.state).map(({ from, to }) => ({
			from,
			to: Math.max(to, Math.min(from + 1, view.state.doc.length)),
			severity: "error",
			message: "Syntax error",
		})),
	{ delay: 400 },
);

// Number of syntax errors in the text, or null when the language cannot report any
export function countSyntaxErrors(text: string, support: LanguageSupport | null): number | null {
	if (!support || text.length > MAX_CHECK_LENGTH) return null;
	let errors = 0;
	support.language.parser.parse(text).iterate({
		enter(node) {
			if (node.type.isError) errors++;
		},
	});
	return errors;
}
