import { describe, expect, it } from "vitest";

import { matchSpacing, spacingOf, spacingsOfHtml } from "@/features/office/documents/lib/paragraphSpacing";

describe("paragraphSpacing", () => {
	it("reads the note a paragraph carries and refuses a damaged one", () => {
		expect(spacingOf("12.0,6.0,18.0,-9.0,1")).toEqual({ before: 12, after: 6, left: 18, first: -9, toc: true, brk: false, valign: undefined, keep: false });
		expect(spacingOf("0,0,0,0,0,1,c")).toMatchObject({ brk: true, valign: "c" });
		expect(spacingOf("a,b")).toBeUndefined();
		expect(spacingOf(null)).toBeUndefined();
	});

	it("lists one entry per block in order and skips paragraphs inside tables", () => {
		const html = '<h1 data-nx-sp="14,0,0,0,0">T</h1><table><tr><td data-nx-sp="1,1,0,0,0">c</td></tr></table><ul><li data-nx-sp="0,2,0,0,0">a<ul><li>n</li></ul></li><li>b</li></ul><p>x</p>';
		const list = spacingsOfHtml(html);
		expect(list.map((s) => s.text)).toEqual(["T", "a", "n", "b", "x"]);
		expect(list.map((s) => s.sp?.before)).toEqual([14, 0, undefined, undefined, undefined]);
	});

	it("matches paragraphs to blocks by text, stepping over a table that throws the count off", () => {
		const specs = spacingsOfHtml('<h1 data-nx-sp="14,0,0,0,0">T</h1><table><tr><td>c</td></tr></table><p data-nx-sp="0,8,0,0,0"></p><p style="break-before:page">&nbsp;</p><p data-nx-sp="1,2,0,0,0">x</p>');
		const m = matchSpacing(specs, [{ id: "h", text: "T" }, { id: "t", text: null }, { id: "br", text: "" }, { id: "p", text: "x" }]);
		expect(m.get("h")?.before).toBe(14);
		expect(m.get("br")?.brk).toBe(true);
		expect(m.get("p")?.after).toBe(2);
		expect(m.has("t")).toBe(false);
	});
});
