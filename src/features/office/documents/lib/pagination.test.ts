import { describe, expect, it } from "vitest";

import { paginate } from "@/features/office/documents/lib/pagination";

describe("paginate", () => {
	// A page holds 100 of text and 20 lies between one page's text and the next's
	const room = 100;
	const gap = 20;

	it("leaves blocks that fit where they are", () => {
		const r = paginate([{ top: 0, height: 40 }, { top: 40, height: 40 }], room, gap);
		expect(r).toEqual({ push: [0, 0], split: [null, null], pages: 1 });
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

	it("lets a block's space after hang below the end of the page", () => {
		// 90 + 15 is past the page's 100, but 5 of it is the space after: it stays, and the next block starts the next page
		expect(paginate([{ top: 0, height: 90 }, { top: 90, height: 15, after: 5 }, { top: 105, height: 10 }], room, gap).push).toEqual([0, 0, 15]);
	});

	it("breaks a table that runs over the end of a page before its first row that does not fit", () => {
		// Rows of 20 from 60: two fit (to 100), the third (from 40 in the table) starts the next page at 120, so it moves down 20
		const r = paginate([{ top: 0, height: 60 }, { top: 60, height: 60, rows: [[0, 20], [20, 40], [40, 60]] }, { top: 120, height: 10 }], room, gap);
		expect(r.split).toEqual([null, { at: 2, px: 20 }, null]);
		expect(r.push).toEqual([0, 0, 0]);
		expect(r.pages).toBe(2);
	});

	it("needs only the first line of the next block on the heading's page, across headings in a row", () => {
		// Two headings (70 to 90) and a long list whose first line ends at 100: that fits, so nothing moves
		const fits = paginate([{ top: 0, height: 70 }, { top: 70, height: 10, keepNext: true }, { top: 80, height: 10, keepNext: true }, { top: 90, height: 60, first: 10 }], room, gap);
		expect(fits.push.slice(0, 3)).toEqual([0, 0, 0]);
		// With its first line ending at 105 it does not, and both headings move with it
		const moves = paginate([{ top: 0, height: 75 }, { top: 75, height: 10, keepNext: true }, { top: 85, height: 10, keepNext: true }, { top: 95, height: 60, first: 10 }], room, gap);
		expect(moves.push.slice(0, 3)).toEqual([0, 45, 0]);
	});

	it("lets a block taller than a page run over, and handles no blocks", () => {
		expect(paginate([{ top: 0, height: 250 }], room, gap)).toEqual({ push: [0], split: [null], pages: 3 });
		expect(paginate([], room, gap)).toEqual({ push: [], split: [], pages: 1 });
	});

	it("starts a page at a break, and puts a short section in the middle of its page", () => {
		const r = paginate([{ top: 0, height: 20, valign: "c" }, { top: 20, height: 20 }, { top: 40, height: 30, breakBefore: true }], room, gap);
		// The first section is 40 of 100: it moves down 30; the next starts the following page (at 120), after the 30 already pushed
		expect(r.push).toEqual([30, 0, 50]);
		expect(r.pages).toBe(2);
		expect(paginate([{ top: 0, height: 10 }, { top: 10, height: 10, breakBefore: true }], room, gap).push).toEqual([0, 110]);
	});
});
