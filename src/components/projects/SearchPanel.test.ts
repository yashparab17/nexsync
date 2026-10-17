import { describe, expect, it } from "vitest";

import { byFile } from "./SearchPanel";

const m = (path: string, line: number) => ({ path, line, text: "x", start: 0, end: 1 });

describe("SearchPanel", () => {
	it("groups matches by file in the order they were found", () => {
		const g = byFile([m("a.ts", 1), m("a.ts", 4), m("b.ts", 2), m("c.ts", 9)]);
		expect(g.map((x) => [x.path, x.matches.length])).toEqual([["a.ts", 2], ["b.ts", 1], ["c.ts", 1]]);
		expect(byFile([])).toEqual([]);
	});
});
