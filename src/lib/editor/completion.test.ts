import { CompletionContext } from "@codemirror/autocomplete";
import { ensureSyntaxTree, LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { beforeAll, describe, expect, it } from "vitest";

import { codeCompletion, namingNew } from "@/lib/editor/completion";

let python: LanguageSupport;
beforeAll(async () => {
	python = await LanguageDescription.matchFilename(languages, "main.py")!.load();
});

const at = (doc: string) => {
	const state = EditorState.create({ doc, extensions: [python] });
	ensureSyntaxTree(state, doc.length, 1000);
	return new CompletionContext(state, doc.length, false);
};

describe("code suggestions", () => {
	it("stay quiet while a name is being given", () => {
		expect(namingNew(at("class Block:\n  def __init__(self, index, comp"))).toBe(true);
		expect(namingNew(at("def comp"))).toBe(true);
		expect(namingNew(at("class Blo"))).toBe(true);
	});

	it("still suggest where a name is used", async () => {
		expect(namingNew(at("x = comp"))).toBe(false);
		const result = await codeCompletion(at("x = comp"));
		expect(result?.options.map((o) => o.label)).toEqual(expect.arrayContaining(["compile", "complex"]));
	});

	it("do not offer the word being typed as a suggestion of itself", async () => {
		const result = await codeCompletion(at("def f(a):\n  return a\ncomp = 1\nx = comp"));
		expect(result?.options.filter((o) => o.label === "comp" && o.type === "variable")).toHaveLength(0);
	});
});
