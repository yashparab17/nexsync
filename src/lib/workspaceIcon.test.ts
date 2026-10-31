import { describe, expect, it } from "vitest";

import { GLYPHS, getIcon, iconFromEntries, parseIcon, setIcon } from "@/lib/workspaceIcon";

describe("workspace icon", () => {
	it("reads a picture, an emoji or a letter, and nothing else", () => {
		expect(parseIcon('{"kind":"glyph","glyph":"🚀"}')).toEqual({ kind: "glyph", glyph: "🚀" });
		expect(parseIcon('{"kind":"glyph","glyph":"A"}')).toEqual({ kind: "glyph", glyph: "A" });
		expect(parseIcon('{"kind":"glyph","glyph":"toolong"}')).toBeNull();
		// An emoji made of several joined ones is an emoji; the same number of plain letters is not
		expect(parseIcon('{"kind":"glyph","glyph":"👨‍💻"}')).toEqual({ kind: "glyph", glyph: "👨‍💻" });
		expect(parseIcon('{"kind":"glyph","glyph":"abcdef"}')).toBeNull();
		expect(parseIcon('{"kind":"image","data":"data:image/png;base64,AAAA"}')?.kind).toBe("image");
		// A picture address that is not a picture, or that carries script, is refused
		expect(parseIcon('{"kind":"image","data":"javascript:alert(1)"}')).toBeNull();
		expect(parseIcon('{"kind":"image","data":"data:text/html;base64,AAAA"}')).toBeNull();
		expect(parseIcon("not json")).toBeNull();
		expect(parseIcon(null)).toBeNull();
	});

	it("keeps an icon per workspace and forgets it when cleared", () => {
		setIcon("w1", { kind: "glyph", glyph: GLYPHS[0] });
		expect(getIcon("w1")).toEqual({ kind: "glyph", glyph: GLYPHS[0] });
		expect(getIcon("w2")).toBeNull();
		setIcon("w1", null);
		expect(getIcon("w1")).toBeNull();
	});
});

describe("the shared icon", () => {
	const entry = (ts: number, body: string) => ({ id: String(ts), kind: "icon" as const, channel: "workspace", parent: "", author: "a", name: "A", ts, body, sig: "" });
	it("is the newest entry, null when cleared, undefined when never set", () => {
		expect(iconFromEntries([])).toBeUndefined();
		expect(iconFromEntries([entry(1, '{"kind":"glyph","glyph":"🚀"}'), entry(2, '{"kind":"glyph","glyph":"🎯"}')])).toEqual({ kind: "glyph", glyph: "🎯" });
		expect(iconFromEntries([entry(1, '{"kind":"glyph","glyph":"🚀"}'), entry(2, '{"kind":"none"}')])).toBeNull();
	});
});

describe("icon colours", () => {
	it("keeps a chosen colour from the palette on an emoji or a letter, and drops any other", () => {
		expect(parseIcon('{"kind":"letter","color":"#d22d64"}')).toEqual({ kind: "letter", color: "#d22d64" });
		expect(parseIcon('{"kind":"letter","color":"red"}')).toBeNull();
		expect(parseIcon('{"kind":"glyph","glyph":"🚀","color":"#1c823e"}')).toEqual({ kind: "glyph", glyph: "🚀", color: "#1c823e" });
		expect(parseIcon('{"kind":"glyph","glyph":"🚀","color":"#000000"}')).toEqual({ kind: "glyph", glyph: "🚀" });
	});
});
