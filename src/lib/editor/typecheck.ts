// Type errors a merge may have introduced, from the TypeScript compiler. A merge of two edits that each parse can still
// leave code that does not type-check (a name one person renamed and the other still uses). Only the file itself is checked:
// imports are not followed and no standard library is loaded, so what is counted is the difference between the text before
// and after a merge, and only errors the file alone can show (a name that is not defined, a call with the wrong number of
// arguments). The compiler is large, so it is loaded the first time a collaborator changes a script, not at start.

import type * as TS from "typescript";

// Cannot find name, and the wrong number of arguments
const CODES = new Set([2304, 2552, 2554, 2555]);
const MAX_CHECK_LENGTH = 200_000;

export const canTypeCheck = (fileName: string): boolean => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(fileName);

let ts: typeof TS | null = null;
let loading: Promise<typeof TS> | null = null;

export function loadTypeScript(): Promise<typeof TS> {
	loading ??= import("typescript").then((m) => (ts = (m.default ?? m) as typeof TS));
	return loading;
}

export interface TypeError {
	line: number;
	message: string;
}

// The errors in the text, or null when the compiler is not loaded yet or the text is too large to check on every change
export function typeErrors(fileName: string, text: string): TypeError[] | null {
	if (!ts || text.length > MAX_CHECK_LENGTH) return null;
	const compiler = ts;
	const name = fileName.replace(/^.*[\\/]/, "") || "file.ts";
	const options: TS.CompilerOptions = { noLib: true, noResolve: true, allowJs: true, checkJs: true, noEmit: true, target: compiler.ScriptTarget.ESNext, jsx: compiler.JsxEmit.Preserve, types: [], skipLibCheck: true };
	const source = compiler.createSourceFile(name, text, compiler.ScriptTarget.ESNext, true, /\.tsx$/i.test(name) ? compiler.ScriptKind.TSX : /\.jsx$/i.test(name) ? compiler.ScriptKind.JSX : /\.(js|mjs|cjs)$/i.test(name) ? compiler.ScriptKind.JS : compiler.ScriptKind.TS);
	const host: TS.CompilerHost = {
		getSourceFile: (f) => (f === name ? source : undefined),
		getDefaultLibFileName: () => "lib.d.ts",
		writeFile: () => {},
		getCurrentDirectory: () => "",
		getDirectories: () => [],
		fileExists: (f) => f === name,
		readFile: (f) => (f === name ? text : undefined),
		getCanonicalFileName: (f) => f,
		useCaseSensitiveFileNames: () => true,
		getNewLine: () => "\n",
	};
	try {
		const program = compiler.createProgram([name], options, host);
		return program
			.getSemanticDiagnostics(source)
			.filter((d) => CODES.has(d.code) && d.start !== undefined)
			.map((d) => ({ line: source.getLineAndCharacterOfPosition(d.start!).line + 1, message: compiler.flattenDiagnosticMessageText(d.messageText, "\n") }));
	} catch {
		return null;
	}
}

// The first error that is in the text after but not before, by message: where a person should look
export function firstNewError(before: TypeError[], after: TypeError[]): TypeError | null {
	const had = new Map<string, number>();
	for (const e of before) had.set(e.message, (had.get(e.message) ?? 0) + 1);
	for (const e of after) {
		const n = had.get(e.message) ?? 0;
		if (n === 0) return e;
		had.set(e.message, n - 1);
	}
	return after[0] ?? null;
}
