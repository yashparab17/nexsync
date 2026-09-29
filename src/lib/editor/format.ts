// Code formatting with Prettier. The formatter and each language plugin load only when first used.

import { extensionOf } from "./languages";

type PluginLoader = () => Promise<unknown>;

const babel: PluginLoader[] = [() => import("prettier/plugins/babel"), () => import("prettier/plugins/estree")];
const typescript: PluginLoader[] = [() => import("prettier/plugins/typescript"), () => import("prettier/plugins/estree")];
const postcss: PluginLoader[] = [() => import("prettier/plugins/postcss")];

const FORMATTERS: Record<string, { parser: string; plugins: PluginLoader[] }> = {
	js: { parser: "babel", plugins: babel },
	jsx: { parser: "babel", plugins: babel },
	mjs: { parser: "babel", plugins: babel },
	cjs: { parser: "babel", plugins: babel },
	json: { parser: "json", plugins: babel },
	ts: { parser: "typescript", plugins: typescript },
	tsx: { parser: "typescript", plugins: typescript },
	css: { parser: "css", plugins: postcss },
	scss: { parser: "scss", plugins: postcss },
	less: { parser: "less", plugins: postcss },
	html: { parser: "html", plugins: [() => import("prettier/plugins/html")] },
	htm: { parser: "html", plugins: [() => import("prettier/plugins/html")] },
	md: { parser: "markdown", plugins: [() => import("prettier/plugins/markdown")] },
	markdown: { parser: "markdown", plugins: [() => import("prettier/plugins/markdown")] },
	yaml: { parser: "yaml", plugins: [() => import("prettier/plugins/yaml")] },
	yml: { parser: "yaml", plugins: [() => import("prettier/plugins/yaml")] },
};

export const canFormat = (fileName: string) => extensionOf(fileName) in FORMATTERS;

// Returns the formatted text; throws if the code does not parse, so the caller can show why
export async function formatCode(text: string, fileName: string): Promise<string> {
	const formatter = FORMATTERS[extensionOf(fileName)];
	if (!formatter) return text;
	const [prettier, ...plugins] = await Promise.all([
		import("prettier/standalone"),
		...formatter.plugins.map((load) => load()),
	]);
	return prettier.format(text, { parser: formatter.parser, plugins: plugins as never[], useTabs: true });
}

// The smallest single edit that turns before into after, so formatting does not overwrite a collaborator typing elsewhere
export function minimalChange(before: string, after: string): { from: number; to: number; insert: string } | null {
	if (before === after) return null;
	let start = 0;
	const max = Math.min(before.length, after.length);
	while (start < max && before[start] === after[start]) start++;
	let endBefore = before.length;
	let endAfter = after.length;
	while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
		endBefore--;
		endAfter--;
	}
	return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}
