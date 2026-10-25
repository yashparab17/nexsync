import { describe, expect, it } from "vitest";

import { locateDocAnchor, makeDocAnchor } from "@/features/office/documents/lib/documentComments";

// A document of blocks: each block is a container (id) holding one text block
const docOf = (blocks: [string, string][]) => ({
	descendants(f: (n: never, pos: number, parent: never) => boolean | void) {
		let pos = 0;
		for (const [id, text] of blocks) {
			const container = { isTextblock: false, textContent: "", attrs: { id } };
			f(container as never, pos, null as never);
			f({ isTextblock: true, textContent: text, attrs: {} } as never, pos + 1, container as never);
			pos += text.length + 4;
		}
	},
});

describe("document comment anchors", () => {
	const doc = docOf([["a", "Hello brave world"], ["b", "Second paragraph"]]);
	it("round-trips, follows moved words, and orphans deleted ones", () => {
		const anchor = makeDocAnchor(doc, 8, 13)!; // "brave"
		expect(anchor.quote).toBe("brave");
		expect(locateDocAnchor(doc, anchor)).toEqual({ state: "on", from: 8, to: 13 });
		const moved = docOf([["b", "Second paragraph"], ["c", "so brave a start"]]);
		expect(locateDocAnchor(moved, anchor).state).toBe("moved");
		expect(locateDocAnchor(docOf([["a", "Hello world"]]), anchor).state).toBe("orphaned");
	});
});
