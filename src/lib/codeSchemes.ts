// Colours for code. By default they follow the app theme ("auto": the theme's own accent, success, warning and so on, set
// as --syn-* in index.css). A scheme replaces those ten variables, and people can make their own, one for each mode.

import { isColor, type ThemeMode } from "@/lib/themes";

export const SYNTAX_TOKENS = [
	{ key: "keyword", label: "Keywords", hint: "if, return, const" },
	{ key: "string", label: "Strings", hint: "\"text\"" },
	{ key: "number", label: "Numbers", hint: "42, 3.14" },
	{ key: "function", label: "Functions", hint: "names being called or defined" },
	{ key: "type", label: "Types", hint: "classes, interfaces" },
	{ key: "variable", label: "Variables", hint: "names and properties" },
	{ key: "tag", label: "Tags", hint: "HTML tags, Markdown headings" },
	{ key: "constant", label: "Constants", hint: "true, null, enums" },
	{ key: "comment", label: "Comments", hint: "notes in the code" },
	{ key: "operator", label: "Operators", hint: "+ = => &&" },
] as const;

export type SyntaxKey = (typeof SYNTAX_TOKENS)[number]["key"];
export type SyntaxVars = Record<SyntaxKey, string>;

export interface CodeSchemeDef {
	id: string;
	name: string;
	mode: ThemeMode;
	vars: SyntaxVars;
	custom?: boolean;
}

// Follows the app theme
export const AUTO_SCHEME = "auto";

const v = (keyword: string, string: string, number: string, fn: string, type: string, variable: string, tag: string, constant: string, comment: string, operator: string): SyntaxVars => ({ keyword, string, number, function: fn, type, variable, tag, constant, comment, operator });

export const BUILTIN_SCHEMES: CodeSchemeDef[] = [
	{ id: "mocha", name: "Catppuccin Mocha", mode: "dark", vars: v("#cba6f7", "#a6e3a1", "#fab387", "#89b4fa", "#f9e2af", "#cdd6f4", "#f38ba8", "#f5c2e7", "#7f849c", "#89dceb") },
	{ id: "solarized-dark", name: "Solarized Dark", mode: "dark", vars: v("#9aae1a", "#35b0a6", "#e0589a", "#4aa8e8", "#d6a21a", "#a4b1b1", "#ff6b66", "#e8683a", "#75898f", "#a4b1b1") },
	{ id: "gruvbox-dark", name: "Gruvbox Dark", mode: "dark", vars: v("#fb4934", "#b8bb26", "#d3869b", "#83a598", "#fabd2f", "#ebdbb2", "#fb4934", "#fe8019", "#a89984", "#8ec07c") },
	{ id: "github-dark", name: "GitHub Dark", mode: "dark", vars: v("#ff7b72", "#a5d6ff", "#79c0ff", "#d2a8ff", "#ffa657", "#e6edf3", "#7ee787", "#79c0ff", "#8b949e", "#79c0ff") },
	{ id: "latte", name: "Catppuccin Latte", mode: "light", vars: v("#8839ef", "#2f7d1f", "#c2500a", "#1850c9", "#9a5f0a", "#4c4f69", "#b00d31", "#b8399b", "#6c6f85", "#0b78a8") },
	{ id: "solarized-light", name: "Solarized Light", mode: "light", vars: v("#667700", "#156d68", "#b52a6a", "#1b659e", "#85620a", "#475c63", "#b8262a", "#a8400f", "#6c7f85", "#586e75") },
	{ id: "gruvbox-light", name: "Gruvbox Light", mode: "light", vars: v("#9d0006", "#5f5c0a", "#8f3f71", "#076678", "#8f5a0a", "#3c3836", "#9d0006", "#af3a03", "#7c6f64", "#427b58") },
	{ id: "github-light", name: "GitHub Light", mode: "light", vars: v("#cf222e", "#0a3069", "#0550ae", "#8250df", "#953800", "#1f2328", "#116329", "#0550ae", "#59636e", "#0550ae") },
];

export const MAX_SCHEME_NAME = 40;

// The style rule for a scheme: it applies when <html> has data-code set to its id
export function schemeCss(def: CodeSchemeDef): string {
	return `:root[data-code="${def.id}"] {\n${SYNTAX_TOKENS.map((t) => `  --syn-${t.key}: ${def.vars[t.key]};`).join("\n")}\n}`;
}

export const syntaxToText = (vars: SyntaxVars) => SYNTAX_TOKENS.map((t) => `--syn-${t.key}: ${vars[t.key]};`).join("\n");

// Reads that text back (the "--syn-" part of a name may be left off); lines that are not a known colour with a safe value are
// skipped and counted
export function textToSyntax(text: string, base: SyntaxVars): { vars: SyntaxVars; skipped: number } {
	const vars = { ...base };
	let skipped = 0;
	for (const raw of text.split(/[\n;]/)) {
		const line = raw.trim();
		if (!line) continue;
		const m = /^(?:--syn-)?([a-z]+)\s*:\s*(.+)$/.exec(line);
		const key = SYNTAX_TOKENS.find((t) => t.key === m?.[1])?.key;
		if (m && key && isColor(m[2].trim())) vars[key] = m[2].trim();
		else skipped++;
	}
	return { vars, skipped };
}

export function cleanCustomSchemes(value: unknown): CodeSchemeDef[] {
	if (!Array.isArray(value)) return [];
	const out: CodeSchemeDef[] = [];
	for (const t of value) {
		if (!t || typeof t !== "object") continue;
		const { id, name, mode, vars } = t as Partial<CodeSchemeDef>;
		if (typeof id !== "string" || !/^code-[a-z0-9]{4,12}$/.test(id) || typeof name !== "string" || (mode !== "light" && mode !== "dark") || !vars || typeof vars !== "object") continue;
		const clean = { ...BUILTIN_SCHEMES.find((b) => b.mode === mode)!.vars };
		for (const { key } of SYNTAX_TOKENS) {
			const c = (vars as Record<string, unknown>)[key];
			if (typeof c === "string" && isColor(c.trim())) clean[key] = c.trim();
		}
		out.push({ id, name: name.slice(0, MAX_SCHEME_NAME) || "Custom colours", mode, vars: clean, custom: true });
	}
	return out;
}
