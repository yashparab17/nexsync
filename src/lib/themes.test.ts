import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES, TOKENS, cleanCustomThemes, contrast, isColor, textToVars, themeCss, secondaryShare, themeWarnings, THEME_FAMILIES, varsToText } from "@/lib/themes";

describe("themes", () => {
	it("has six light and six dark themes, each with every colour", () => {
		for (const mode of ["light", "dark"] as const) expect(BUILTIN_THEMES.filter((t) => t.mode === mode)).toHaveLength(6);
		for (const t of BUILTIN_THEMES) for (const { key } of TOKENS) expect(isColor(t.vars[key]), `${t.id} ${key}`).toBe(true);
	});

	it("only accepts colours that cannot break out of a style rule", () => {
		expect(isColor("#abc")).toBe(true);
		expect(isColor("oklch(0.7 0.1 180 / 50%)")).toBe(true);
		expect(isColor("red; } body { display: none")).toBe(false);
		expect(isColor("url(x)")).toBe(false);
	});

	it("round-trips through CSS text and skips bad lines", () => {
		const base = BUILTIN_THEMES[0].vars;
		expect(textToVars(varsToText(base), base)).toEqual({ vars: base, skipped: 0 });
		const r = textToVars("--primary: #123456;\n--nope: #fff;\n--border: expression(1);", base);
		expect(r.vars.primary).toBe("#123456");
		expect(r.skipped).toBe(2);
	});

	it("scopes a dark theme to the dark class and fills in derived colours", () => {
		const css = themeCss(BUILTIN_THEMES.find((t) => t.id === "gruvbox-dark")!);
		expect(css).toContain('.dark[data-theme="gruvbox-dark"]');
		expect(css).toContain("--chart-3:");
	});

	it("drops stored custom themes that are not well formed", () => {
		const ok = { id: "custom-abcd1234", name: "Mine", mode: "dark", vars: { primary: "#ff0000", border: "evil;}" } };
		const [t, ...rest] = cleanCustomThemes([ok, { id: "x", name: "bad", mode: "dark", vars: {} }, null]);
		expect(rest).toHaveLength(0);
		expect(t.vars.primary).toBe("#ff0000");
		expect(t.vars.border).not.toBe("evil;}");
	});

	it("keeps text readable and fills visible without borders, in every built-in theme", () => {
		for (const t of BUILTIN_THEMES) expect(themeWarnings(t.vars), t.id).toEqual([]);
	});

	it("warns about a theme someone makes unreadable", () => {
		const base = BUILTIN_THEMES[0].vars;
		expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
		expect(themeWarnings({ ...base, foreground: base.background }).join(" ")).toContain("Text is hard to read");
		expect(themeWarnings({ ...base, input: base.background }).join(" ")).toContain("blend into the page");
	});

	it("lets secondary text use more of the text colour where 66% is too faint", () => {
		const get = (id: string, mode: string) => BUILTIN_THEMES.find((t) => t.id === id && t.mode === mode)!.vars;
		expect(secondaryShare(get("cyber", "dark"))).toBe(66);
		expect(secondaryShare(get("latte", "light"))).toBeGreaterThan(66);
	});

	it("only has themes in pairs, one light and one dark", () => {
		for (const f of THEME_FAMILIES) {
			expect(BUILTIN_THEMES.some((t) => t.id === f.light && t.mode === "light"), f.id).toBe(true);
			expect(BUILTIN_THEMES.some((t) => t.id === f.dark && t.mode === "dark"), f.id).toBe(true);
		}
		expect(BUILTIN_THEMES).toHaveLength(THEME_FAMILIES.length * 2);
	});
});
