import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { applyHunks, hunksFromDelta, suggestRepair, type Hunk } from "./mergeRepair";

// Stands in for a parser: how far the braces are from balanced
const braces = (text: string) => Math.abs((text.match(/\{/g) ?? []).length - (text.match(/\}/g) ?? []).length);

describe("merge repair", () => {
	it("reads the changes a remote update made to the local text as hunks", () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		a.getText("t").insert(0, "one\ntwo\nthree\n");
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
		let before = "";
		let hunks: Hunk[] = [];
		a.getText("t").observe((event) => {
			hunks = hunksFromDelta(event.changes.delta as never);
		});
		before = a.getText("t").toString();
		b.getText("t").insert(0, "zero\n");
		b.getText("t").delete(9, 3); // "two", after the new line
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		expect(hunks).toEqual([
			{ at: 0, remove: 0, insert: "zero\n" },
			{ at: 4, remove: 3, insert: "" },
		]);
		expect(applyHunks(before, hunks, [true, true])).toBe(a.getText("t").toString());
		expect(applyHunks(before, hunks, [false, false])).toBe(before);
		expect(applyHunks(before, hunks, [false, true])).toBe("one\n\nthree\n");
	});

	it("keeps a removal and an insertion at the same place together as one replacement", () => {
		expect(hunksFromDelta([{ retain: 3 }, { delete: 2 }, { insert: "xy" }, { retain: 4 }, { insert: "!" }])).toEqual([
			{ at: 3, remove: 2, insert: "xy" },
			{ at: 9, remove: 0, insert: "!" },
		]);
	});

	it("keeps as much of the change as it can while dropping what breaks the code", () => {
		const before = "function f() {\n  a();\n}\n";
		const hunks: Hunk[] = [
			{ at: 0, remove: 0, insert: "// note\n" }, // harmless
			{ at: 15, remove: 0, insert: "  b();\n" }, // harmless
			{ at: before.length, remove: 0, insert: "}\n" }, // an extra closing brace
		];
		const merged = applyHunks(before, hunks, [true, true, true]);
		expect(braces(merged)).toBe(1);
		const fix = suggestRepair(before, hunks, { errors: braces });
		expect(fix).not.toBeNull();
		expect(fix!.keep).toEqual([true, true, false]);
		expect(fix!.errors).toBe(0);
		expect(fix!.text).toBe("// note\nfunction f() {\n  b();\n  a();\n}\n");
	});

	it("says nothing when the whole change is fine, and gives up when no part of it is", () => {
		const before = "{ }";
		expect(suggestRepair(before, [{ at: 0, remove: 0, insert: "// ok\n" }], { errors: braces })).toBeNull();
		const alone: Hunk[] = [{ at: 3, remove: 0, insert: "}" }];
		expect(suggestRepair(before, alone, { errors: braces })).toBeNull();
		expect(suggestRepair(before, [], { errors: braces })).toBeNull();
		expect(suggestRepair(before, alone, { errors: () => null })).toBeNull();
	});

	it("stops after the number of checks it was given", () => {
		const hunks: Hunk[] = Array.from({ length: 12 }, (_, i) => ({ at: 0, remove: 0, insert: i === 7 ? "}" : "x" }));
		let calls = 0;
		const counted = (text: string) => (calls++, braces(text));
		expect(suggestRepair("{ }", hunks, { errors: counted, budget: 5 })).toBeNull();
		expect(calls).toBeLessThanOrEqual(6);
	});
});
