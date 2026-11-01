// Suggestions for the editor. The language's own sources (keywords, built-ins, names already in the file, and a language server's when
// one is on) are asked together, with two differences from the default: none while a name is being given (a parameter, a function or
// a class), because that name is new and offering existing ones is noise, and not the word being typed as a suggestion of itself.

import type { CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";

// True when the word at the cursor is a name being introduced, as in `def f(self, comp` or `class Blo`
export function namingNew(ctx: CompletionContext): boolean {
	const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
	if (node.name !== "VariableName" || !node.parent) return false;
	const before = node.prevSibling?.name;
	if (node.parent.name === "ParamList") return before === "(" || before === ",";
	if (node.parent.name === "FunctionDefinition") return before === "def";
	if (node.parent.name === "ClassDefinition") return before === "class";
	return false;
}

export const codeCompletion: CompletionSource = async (ctx) => {
	if (namingNew(ctx)) return null;
	const sources = ctx.state.languageDataAt<CompletionSource>("autocomplete", ctx.pos);
	const results = (await Promise.all(sources.map((source) => source(ctx)))).filter((r): r is CompletionResult => !!r);
	if (results.length === 0) return null;
	// ponytail: sources that start the word in different places are dropped; they all start at the same word in practice.
	const from = results[0].from;
	const typed = ctx.state.sliceDoc(from, ctx.pos);
	const options = results.filter((r) => r.from === from).flatMap((r) => r.options).filter((o) => !(o.label === typed && o.type === "variable"));
	return options.length === 0 ? null : { from, options };
};
