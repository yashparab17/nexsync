import { beforeAll, describe, expect, it } from "vitest";

import { canTypeCheck, firstNewError, loadTypeScript, typeErrors } from "./typecheck";

beforeAll(async () => {
	await loadTypeScript();
}, 60_000);

describe("type check of a merge", () => {
	it("only offers to check scripts", () => {
		expect(canTypeCheck("a/b.ts")).toBe(true);
		expect(canTypeCheck("x.jsx")).toBe(true);
		expect(canTypeCheck("notes.md")).toBe(false);
	});
	it("counts a name that is no longer defined and a call with the wrong number of arguments", () => {
		const before = "function total(a: number, b: number) { return a + b; }\nconst x = total(1, 2);\n";
		expect(typeErrors("a.ts", before)).toEqual([]);
		// One person renamed the function, the other kept calling it by the old name
		const renamed = "function sum(a: number, b: number) { return a + b; }\nconst x = total(1, 2);\n";
		const errors = typeErrors("a.ts", renamed)!;
		expect(errors).toHaveLength(1);
		expect(errors[0].line).toBe(2);
		// The other added a parameter while a caller still passes two
		const wider = "function total(a: number, b: number, c: number) { return a + b + c; }\nconst x = total(1, 2);\n";
		expect(typeErrors("a.ts", wider)!.length).toBe(1);
	});
	it("does not follow imports, so an imported name is not an error, and says where the new one is", () => {
		expect(typeErrors("a.ts", "import { thing } from './other';\nthing(1);\n")).toEqual([]);
		const was = [{ line: 1, message: "Cannot find name 'a'." }];
		const now = [...was, { line: 5, message: "Cannot find name 'b'." }];
		expect(firstNewError(was, now)?.line).toBe(5);
	});
});
