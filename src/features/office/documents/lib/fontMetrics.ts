// How tall a line of each font is at single spacing, as a multiple of the font's size, as Word measures it (the font's own ascent and
// descent; Inter 1.21, Calibri 1.22, Consolas 1.171). The backend sends these with a file it opens; a font it did not send is taken
// as 1.2, about what most fonts are.

const factors = new Map<string, number>();

export const DEFAULT_LINE_FACTOR = 1.2;

export function setFontFactors(table: Record<string, number> | undefined) {
	for (const [font, k] of Object.entries(table ?? {})) if (Number.isFinite(k) && k > 0.5 && k < 3) factors.set(font.toLowerCase(), k);
}

export function lineFactor(font: string | undefined): number {
	if (!font) return DEFAULT_LINE_FACTOR;
	return factors.get(font.split(",")[0].replace(/["']/g, "").trim().toLowerCase()) ?? DEFAULT_LINE_FACTOR;
}
