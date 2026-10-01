// The Catppuccin accent colours (Latte in the light theme, Mocha in the dark one) as CSS variables, so a colour
// picked here follows the theme. Used where something needs a colour that is stable per name: tags and collaborators.

export const ACCENTS = ["rosewater", "flamingo", "pink", "mauve", "red", "maroon", "peach", "yellow", "green", "teal", "sky", "sapphire", "blue", "lavender"] as const;
export type Accent = (typeof ACCENTS)[number];

// The same text always gets the same accent
export function accentFor(text: string, choices: readonly Accent[] = ACCENTS): Accent {
	let hash = 0;
	for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return choices[hash % choices.length];
}

export const accentVar = (accent: Accent) => `var(--ctp-${accent})`;

// The accent mixed into transparent, for soft backgrounds and selections
export const accentSoft = (accent: Accent, percent: number) => `color-mix(in srgb, var(--ctp-${accent}) ${percent}%, transparent)`;
