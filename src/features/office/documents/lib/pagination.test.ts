import { describe, expect, it } from "vitest";

import { paginate } from "@/features/office/documents/lib/pagination";

describe("paginate", () => {
	// A page holds 100 of text and 20 lies between one page's text and the next's
	const room = 100;
	const gap = 20;

	it("leaves blocks that fit where they are", () => {
		const r = paginate([{ top: 0, height: 40 }, { top: 40, height: 40 }], room, gap);
		expect(r).toEqual({ push: [0, 0], pages: 1 });
	});

	it("moves a block that would cross the end of a page to the start of the next", () => {
		const r = paginate([{ top: 0, height: 70 }, { top: 70, height: 50 }, { top: 120, height: 10 }], room, gap);
		// The second block starts at 70 and would end at 120: it goes to 120 (next page's text starts at room + gap), the third follows it
		expect(r.push).toEqual([0, 50, 0]);
		expect(r.pages).toBe(2);
	});

	it("moves one that starts in the gap, and counts pages from where the last block ends", () => {
		const r = paginate([{ top: 0, height: 100 }, { top: 105, height: 30 }, { top: 135, height: 100 }, { top: 235, height: 10 }], room, gap);
		// 105 is in the gap (15 on), the third would run over page two (90 on), the fourth then starts in the next gap (20 on)
		expect(r.push).toEqual([0, 15, 90, 20]);
		expect(r.pages).toBe(4);
	});

	it("keeps a heading with the block after it", () => {
		const r = paginate([{ top: 0, height: 80 }, { top: 80, height: 15, keepNext: true }, { top: 95, height: 30 }], room, gap);
		// The heading would fit (80 to 95) but its paragraph would not, so both move
		expect(r.push).toEqual([0, 40, 0]);
	});

	it("lets a block taller than a page run over, and handles no blocks", () => {
		expect(paginate([{ top: 0, height: 250 }], room, gap)).toEqual({ push: [0], pages: 3 });
		expect(paginate([], room, gap)).toEqual({ push: [], pages: 1 });
	});

	it("starts a page at a break, and puts a short section in the middle of its page", () => {
		const r = paginate([{ top: 0, height: 20, valign: "c" }, { top: 20, height: 20 }, { top: 40, height: 30, breakBefore: true }], room, gap);
		// The first section is 40 of 100: it moves down 30; the next starts the following page (at 120), after the 30 already pushed
		expect(r.push).toEqual([30, 0, 50]);
		expect(r.pages).toBe(2);
		expect(paginate([{ top: 0, height: 10 }, { top: 10, height: 10, breakBefore: true }], room, gap).push).toEqual([0, 110]);
	});
});
