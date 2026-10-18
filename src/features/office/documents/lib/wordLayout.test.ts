import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { formatNumber, ListCounter, listEnter, type ListLevel } from "@/features/office/documents/lib/wordLayout";

// Just enough of BlockNote's document shape: blocks in a group, each holding one paragraph
const schema = new Schema({
	nodes: {
		doc: { content: "blockGroup" },
		blockGroup: { content: "blockContainer+" },
		blockContainer: { content: "paragraph", attrs: { id: { default: null } } },
		paragraph: { content: "text*", attrs: { numId: { default: 0 }, ilvl: { default: 0 }, listLabel: { default: "" }, pageBreakBefore: { default: false }, sectionVAlign: { default: "" } } },
		text: {},
	},
});
const docOf = (attrs: Record<string, unknown>, text: string) =>
	schema.node("doc", null, [schema.node("blockGroup", null, [schema.node("blockContainer", { id: "a" }, [schema.node("paragraph", attrs, text ? [schema.text(text)] : [])])])]);
const enterAt = (attrs: Record<string, unknown>, text: string, at: number) => {
	const doc = docOf(attrs, text);
	const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3 + at) });
	return listEnter(state.tr);
};

describe("wordLayout", () => {
	it("writes list numbers in each of Word's formats", () => {
		expect([1, 4, 9, 14, 27].map((n) => formatNumber(n, "lowerRoman"))).toEqual(["i", "iv", "ix", "xiv", "xxvii"]);
		expect([1, 26, 27].map((n) => formatNumber(n, "lowerLetter"))).toEqual(["a", "z", "aa"]);
		expect(formatNumber(3, "upperLetter")).toBe("C");
		expect(formatNumber(12, "decimal")).toBe("12");
	});

	it("numbers a list as it stands, starting deeper levels again, and leaves bullets as they are", () => {
		const level = (format: string, text: string): ListLevel => ({ abs: 1, format, text, start: 1, restart: true });
		const lists = { "5:0": level("decimal", "%1."), "5:1": level("lowerLetter", "%1.%2)"), "6:0": { ...level("bullet", "•"), abs: 2 } };
		const c = new ListCounter(lists);
		expect([c.label(5, 0, ""), c.label(5, 1, ""), c.label(5, 1, ""), c.label(6, 0, ""), c.label(5, 0, ""), c.label(5, 1, "")]).toEqual(["1.", "1.a)", "1.b)", "•", "2.", "2.a)"]);
		// A list it has no definition for shows the label the file gave
		expect(c.label(9, 0, "iv.")).toBe("iv.");
	});

	it("keeps Enter in a Word list item in the list, and ends the list on an empty item", () => {
		const item = { numId: 5, ilvl: 1, listLabel: "1.a)", pageBreakBefore: true };
		const split = enterAt(item, "Hello", 5)!;
		const paras: Record<string, unknown>[] = [];
		split.doc.descendants((n) => void (n.type.name === "paragraph" && paras.push(n.attrs)));
		expect(paras).toHaveLength(2);
		expect(paras[1]).toMatchObject({ numId: 5, ilvl: 1, listLabel: "", pageBreakBefore: false });
		expect(enterAt(item, "", 0)!.doc.firstChild!.firstChild!.firstChild!.attrs).toMatchObject({ numId: 0, ilvl: 0 });
		// Not a list item: the editor's own Enter
		expect(enterAt({}, "Hello", 2)).toBeNull();
	});
});
