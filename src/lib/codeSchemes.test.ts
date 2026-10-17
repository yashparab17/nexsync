import { describe, expect, it } from "vitest";

import { BUILTIN_SCHEMES, SYNTAX_TOKENS, cleanCustomSchemes, schemeCss, syntaxToText, textToSyntax } from "@/lib/codeSchemes";
import { isColor } from "@/lib/themes";

describe("code schemes", () => {
	it("has ready-made schemes for both modes, each with every colour", () => {
		expect(BUILTIN_SCHEMES.filter((s) => s.mode === "dark").length).toBeGreaterThanOrEqual(4);
		expect(BUILTIN_SCHEMES.filter((s) => s.mode === "light").length).toBeGreaterThanOrEqual(4);
		for (const s of BUILTIN_SCHEMES) for (const { key } of SYNTAX_TOKENS) expect(isColor(s.vars[key]), `${s.id} ${key}`).toBe(true);
	});

	it("round-trips through CSS text, with or without the --syn- prefix, and skips bad lines", () => {
		const base = BUILTIN_SCHEMES[0].vars;
		expect(textToSyntax(syntaxToText(base), base)).toEqual({ vars: base, skipped: 0 });
		const r = textToSyntax("keyword: #010203;\n--syn-string: red; } x {;\n--other: #fff", base);
		expect(r.vars.keyword).toBe("#010203");
		expect(r.skipped).toBe(3);
	});

	it("scopes a scheme to data-code and drops malformed stored ones", () => {
		expect(schemeCss(BUILTIN_SCHEMES[0])).toContain(`:root[data-code="${BUILTIN_SCHEMES[0].id}"]`);
		expect(cleanCustomSchemes([{ id: "bad", name: "x", mode: "dark", vars: {} }, { id: "code-abcd1234", name: "Mine", mode: "light", vars: { keyword: "#fff" } }])).toHaveLength(1);
	});
});
