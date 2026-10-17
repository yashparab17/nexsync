import { describe, expect, it } from "vitest";

import { chunkHtml } from "./chunkHtml";

describe("chunkHtml", () => {
	it("cuts at top-level elements, by count and by size, and loses nothing", () => {
		const html = Array.from({ length: 10 }, (_, i) => `<p>Paragraph ${i}</p>`).join("");
		const pieces = chunkHtml(html, 4);
		expect(pieces.map((p) => (p.match(/<p>/g) ?? []).length)).toEqual([4, 4, 2]);
		expect(pieces.join("")).toBe(html);
		expect(chunkHtml(`<p>${"x".repeat(50)}</p><p>${"y".repeat(50)}</p>`, 40, 60)).toHaveLength(2);
		expect(chunkHtml("")).toEqual([]);
		// A table or list stays whole
		expect(chunkHtml("<ul><li>a</li><li>b</li></ul><p>c</p>", 1)).toEqual(["<ul><li>a</li><li>b</li></ul>", "<p>c</p>"]);
	});
});
