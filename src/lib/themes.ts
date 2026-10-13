// The themes. Each is the same eighteen colours; everything else (card text, sidebar, charts, the scrim) is worked out from
// them by themeCss, so a theme someone makes can stay short. The two "default" themes are written out in index.css as well, so
// the app is never unstyled before this runs; the copy here is what the picker shows and what a custom theme starts from.

export const TOKENS = [
	{ key: "background", label: "Page background", hint: "Behind everything" },
	{ key: "foreground", label: "Text", hint: "Main text" },
	{ key: "card", label: "Panel", hint: "Panels and raised surfaces" },
	{ key: "popover", label: "Popup", hint: "Menus and dialogs" },
	{ key: "sidebar", label: "Sidebar", hint: "Navigation side" },
	{ key: "primary", label: "Accent", hint: "Buttons, links, selection" },
	{ key: "primary-foreground", label: "Text on accent", hint: "On accent buttons" },
	{ key: "secondary", label: "Secondary surface", hint: "Chips and buttons" },
	{ key: "muted", label: "Muted surface", hint: "Hover and inactive areas" },
	{ key: "muted-foreground", label: "Muted text", hint: "Hints and secondary text" },
	{ key: "accent", label: "Hover surface", hint: "Highlighted rows" },
	{ key: "border", label: "Border", hint: "Lines between things" },
	{ key: "input", label: "Field fill", hint: "Fill of text fields" },
	{ key: "ring", label: "Focus ring", hint: "Keyboard focus" },
	{ key: "destructive", label: "Danger", hint: "Errors and delete" },
	{ key: "success", label: "Success", hint: "Done and online" },
	{ key: "warning", label: "Warning", hint: "Due soon and caution" },
	{ key: "info", label: "Info", hint: "Neutral notices" },
] as const;

export type TokenKey = (typeof TOKENS)[number]["key"];
export type ThemeVars = Record<TokenKey, string>;
export type ThemeMode = "light" | "dark";

export interface ThemeDef {
	id: string;
	name: string;
	mode: ThemeMode;
	vars: ThemeVars;
	// Made by the person using the app, so it can be edited and deleted
	custom?: boolean;
}

export const DEFAULT_THEME = "default";

const light = (id: string, name: string, vars: ThemeVars): ThemeDef => ({ id, name, mode: "light", vars });
const dark = (id: string, name: string, vars: ThemeVars): ThemeDef => ({ id, name, mode: "dark", vars });

export const BUILTIN_THEMES: ThemeDef[] = [
	light("default", "Original light", {
		"background": "#ffffff",
		"foreground": "#09090b",
		"card": "#ffffff",
		"popover": "#ffffff",
		"primary": "#0f766e",
		"primary-foreground": "#f0fdfa",
		"secondary": "#f4f4f5",
		"muted": "#f4f4f5",
		"muted-foreground": "#696972",
		"accent": "#f4f4f5",
		"destructive": "#dc2626",
		"success": "#15803d",
		"warning": "#a16207",
		"info": "#1d4ed8",
		"border": "#e4e4e7",
		"input": "#e4e4e7",
		"ring": "#a1a1aa",
		"sidebar": "#fafafa",
	}),
	light("latte", "Catppuccin Latte", {
		"background": "#dce0e8",
		"foreground": "#4c4f69",
		"card": "#eff1f5",
		"popover": "#eff1f5",
		"primary": "#0e6269",
		"primary-foreground": "#eff1f5",
		"secondary": "#ccd0da",
		"muted": "#ccd0da",
		"muted-foreground": "#52556d",
		"accent": "#ccd0da",
		"destructive": "#b00d31",
		"success": "#26701a",
		"warning": "#8f5200",
		"info": "#1850c9",
		"border": "#bcc0cc",
		"input": "#bcc0cc",
		"ring": "#0e6269",
		"sidebar": "#e6e9ef",
	}),
	light("solarized-light", "Solarized Light", {
		"background": "#eee8d5",
		"foreground": "#475c63",
		"card": "#fdf6e3",
		"popover": "#fdf6e3",
		"primary": "#156d68",
		"primary-foreground": "#fdf6e3",
		"secondary": "#e8e1cb",
		"muted": "#e8e1cb",
		"muted-foreground": "#4f656c",
		"accent": "#e8e1cb",
		"destructive": "#b8262a",
		"success": "#5f6f00",
		"warning": "#85620a",
		"info": "#1b659e",
		"border": "#d3cbb0",
		"input": "#cbc3a6",
		"ring": "#1b7a74",
		"sidebar": "#f5eedb",
	}),
	light("gruvbox-light", "Gruvbox Light", {
		"background": "#ebdbb2",
		"foreground": "#3c3836",
		"card": "#fbf1c7",
		"popover": "#f9f5d7",
		"primary": "#076678",
		"primary-foreground": "#fbf1c7",
		"secondary": "#d5c4a1",
		"muted": "#d5c4a1",
		"muted-foreground": "#5a4f48",
		"accent": "#d5c4a1",
		"destructive": "#9d0006",
		"success": "#5f5c0a",
		"warning": "#7d4b05",
		"info": "#1d5f8a",
		"border": "#bdae93",
		"input": "#a89984",
		"ring": "#076678",
		"sidebar": "#f2e5bc",
	}),
	light("github-light", "GitHub Light", {
		"background": "#e9edf1",
		"foreground": "#1f2328",
		"card": "#ffffff",
		"popover": "#ffffff",
		"primary": "#0860c8",
		"primary-foreground": "#ffffff",
		"secondary": "#dfe4ea",
		"muted": "#dfe4ea",
		"muted-foreground": "#4b5560",
		"accent": "#dfe4ea",
		"destructive": "#cf222e",
		"success": "#17702f",
		"warning": "#8a5a00",
		"info": "#0550ae",
		"border": "#cdd4db",
		"input": "#c3cad2",
		"ring": "#0969da",
		"sidebar": "#f6f8fa",
	}),
	dark("default", "Original dark", {
		"background": "#09090b",
		"foreground": "#fafafa",
		"card": "#18181b",
		"popover": "#18181b",
		"primary": "#2dd4bf",
		"primary-foreground": "#042f2e",
		"secondary": "#27272a",
		"muted": "#27272a",
		"muted-foreground": "#a1a1aa",
		"accent": "#27272a",
		"destructive": "#ff6467",
		"success": "#4ade80",
		"warning": "#fbbf24",
		"info": "#7aa7ff",
		"border": "#2a2a2e",
		"input": "#3a3a3e",
		"ring": "#71717a",
		"sidebar": "#18181b",
	}),
	dark("mocha", "Catppuccin Mocha", {
		"background": "#11111b",
		"foreground": "#cdd6f4",
		"card": "#181825",
		"popover": "#1e1e2e",
		"primary": "#94e2d5",
		"primary-foreground": "#11111b",
		"secondary": "#313244",
		"muted": "#313244",
		"muted-foreground": "#a6adc8",
		"accent": "#313244",
		"destructive": "#f38ba8",
		"success": "#a6e3a1",
		"warning": "#f9e2af",
		"info": "#89b4fa",
		"border": "#313244",
		"input": "#45475a",
		"ring": "#94e2d5",
		"sidebar": "#181825",
	}),
	dark("solarized-dark", "Solarized Dark", {
		"background": "#00212b",
		"foreground": "#eee8d5",
		"card": "#073642",
		"popover": "#073642",
		"primary": "#36b3a9",
		"primary-foreground": "#00212b",
		"secondary": "#0e4552",
		"muted": "#0e4552",
		"muted-foreground": "#a4b1b1",
		"accent": "#0e4552",
		"destructive": "#ff6b66",
		"success": "#9aae1a",
		"warning": "#d6a21a",
		"info": "#4aa8e8",
		"border": "#14505e",
		"input": "#2a6573",
		"ring": "#2aa198",
		"sidebar": "#073642",
	}),
	dark("dracula", "Dracula", {
		"background": "#1e1f29",
		"foreground": "#f8f8f2",
		"card": "#282a36",
		"popover": "#282a36",
		"primary": "#bd93f9",
		"primary-foreground": "#1e1f29",
		"secondary": "#343746",
		"muted": "#343746",
		"muted-foreground": "#aab1d4",
		"accent": "#343746",
		"destructive": "#ff6e6e",
		"success": "#50fa7b",
		"warning": "#f1fa8c",
		"info": "#8be9fd",
		"border": "#44475a",
		"input": "#4d5066",
		"ring": "#bd93f9",
		"sidebar": "#282a36",
	}),
	dark("nord", "Nord", {
		"background": "#242933",
		"foreground": "#eceff4",
		"card": "#2e3440",
		"popover": "#3b4252",
		"primary": "#88c0d0",
		"primary-foreground": "#242933",
		"secondary": "#3b4252",
		"muted": "#3b4252",
		"muted-foreground": "#b0b9cb",
		"accent": "#3b4252",
		"destructive": "#e08790",
		"success": "#a3be8c",
		"warning": "#ebcb8b",
		"info": "#93b4dc",
		"border": "#3b4252",
		"input": "#4c566a",
		"ring": "#88c0d0",
		"sidebar": "#2e3440",
	}),
];

// A colour value that is safe to put in a style sheet: a hex colour or a plain colour function, nothing that could close the
// rule and start another
export const isColor = (value: string) => /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) || /^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb)\([0-9a-z%.,\s/+-]{1,80}\)$/i.test(value);

const DERIVED = (mode: ThemeMode): [string, string][] => [
	["card-foreground", "var(--foreground)"],
	["popover-foreground", "var(--foreground)"],
	["secondary-foreground", "var(--foreground)"],
	["accent-foreground", "var(--foreground)"],
	["sidebar-foreground", "var(--foreground)"],
	["sidebar-primary", "var(--primary)"],
	["sidebar-primary-foreground", "var(--primary-foreground)"],
	["sidebar-accent", "var(--accent)"],
	["sidebar-accent-foreground", "var(--foreground)"],
	["sidebar-border", "var(--border)"],
	["sidebar-ring", "var(--ring)"],
	["chart-1", "var(--primary)"],
	["chart-2", "color-mix(in oklch, var(--primary) 80%, var(--background))"],
	["chart-3", "color-mix(in oklch, var(--primary) 62%, var(--background))"],
	["chart-4", "color-mix(in oklch, var(--primary) 46%, var(--background))"],
	["chart-5", "color-mix(in oklch, var(--primary) 32%, var(--background))"],
	["scrim", mode === "dark" ? "color-mix(in srgb, black 70%, transparent)" : "color-mix(in srgb, var(--foreground) 45%, transparent)"],
];

// Every variable a theme sets, as name and value, including the ones worked out from its colours
export function themeEntries(def: Pick<ThemeDef, "mode" | "vars">): [string, string][] {
	return [...Object.entries(def.vars).map(([k, v]): [string, string] => [k, v]), ...DERIVED(def.mode)];
}

// The style rule for a theme: it applies when <html> has data-theme set to its id, and for the dark ones the dark class too
export function themeCss(def: ThemeDef): string {
	const selector = def.mode === "dark" ? `.dark[data-theme="${def.id}"]` : `:root[data-theme="${def.id}"]`;
	return `${selector} {\n${themeEntries(def).map(([k, v]) => `  --${k}: ${v};`).join("\n")}\n}`;
}

// The theme as the text a person can read and edit: one "--name: value;" line for each colour
// Contrast ratio of two hex colours (WCAG), or null when either is written another way
export function contrast(a: string, b: string): number | null {
	const rgb = (h: string) => {
		const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h.trim());
		if (!m) return null;
		const x = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
		return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
	};
	const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
	const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
	const [x, y] = [rgb(a), rgb(b)];
	if (!x || !y) return null;
	const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
	return (hi + 0.05) / (lo + 0.05);
}

// Plain-words problems with a set of colours: text that is hard to read, or fields and panels that vanish into the page
export function themeWarnings(v: ThemeVars): string[] {
	const out: string[] = [];
	const low = (a: TokenKey, b: TokenKey, min: number) => {
		const c = contrast(v[a], v[b]);
		return c !== null && c < min;
	};
	if (low("foreground", "background", 4.5)) out.push("Text is hard to read on the page background.");
	if (low("muted-foreground", "background", 4.5)) out.push("Muted text is hard to read on the page background.");
	if (low("primary-foreground", "primary", 4.5)) out.push("Text on the accent is hard to read.");
	if (low("input", "background", 1.15)) out.push("Text fields blend into the page. Pick a field fill that differs from the page background.");
	if (low("muted", "background", 1.05)) out.push("Muted surfaces blend into the page, so hover and inactive areas will be hard to see.");
	return out;
}

export const varsToText = (vars: ThemeVars) => TOKENS.map((t) => `--${t.key}: ${vars[t.key]};`).join("\n");

// Reads that text back. Lines that are not a known colour with a safe value are skipped and counted.
export function textToVars(text: string, base: ThemeVars): { vars: ThemeVars; skipped: number } {
	const vars = { ...base };
	let skipped = 0;
	for (const raw of text.split(/[\n;]/)) {
		const line = raw.trim();
		if (!line) continue;
		const m = /^--([a-z-]+)\s*:\s*(.+)$/.exec(line);
		const key = TOKENS.find((t) => t.key === m?.[1])?.key;
		if (m && key && isColor(m[2].trim())) vars[key] = m[2].trim();
		else skipped++;
	}
	return { vars, skipped };
}

export const MAX_THEME_NAME = 40;

// Custom themes as read from storage: anything that is not a well-formed theme is dropped
export function cleanCustomThemes(value: unknown): ThemeDef[] {
	if (!Array.isArray(value)) return [];
	const out: ThemeDef[] = [];
	for (const t of value) {
		if (!t || typeof t !== "object") continue;
		const { id, name, mode, vars } = t as Partial<ThemeDef>;
		if (typeof id !== "string" || !/^custom-[a-z0-9]{4,12}$/.test(id) || typeof name !== "string" || (mode !== "light" && mode !== "dark") || !vars || typeof vars !== "object") continue;
		const base = BUILTIN_THEMES.find((b) => b.mode === mode)!.vars;
		const clean = { ...base };
		for (const { key } of TOKENS) {
			const v = (vars as Record<string, unknown>)[key];
			if (typeof v === "string" && isColor(v.trim())) clean[key] = v.trim();
		}
		out.push({ id, name: name.slice(0, MAX_THEME_NAME) || "Custom theme", mode, vars: clean, custom: true });
	}
	return out;
}
