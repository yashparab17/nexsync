import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { changesOf, compareLines, markValue, newReviewStore, readMark, resolvedSetOf, staleMarksPlugin, strayMarks } from "@/features/office/documents/lib/documentReview";

describe("tracked change marks", () => {
	it("keep who and when, whatever the name holds", () => {
		const v = markValue("Ana | Bo", new Date("2026-10-26T10:00:00Z"));
		expect(readMark(v)).toEqual({ author: "Ana / Bo", date: "2026-10-26T10:00:00.000Z" });
		expect(readMark("Ana")).toEqual({ author: "Ana", date: "" });
	});
});

describe("compareLines", () => {
	it("says nothing about identical text", () => {
		const c = compareLines(["One", "Two"], ["One", "Two"]);
		expect(c.insertions + c.deletions).toBe(0);
		expect(c.rows.every((r) => r.kind === "same")).toBe(true);
	});

	it("marks a paragraph that was added and one that was removed", () => {
		const c = compareLines(["Keep", "Gone", "End"], ["Keep", "End", "New"]);
		expect(c.rows.map((r) => r.kind)).toEqual(["same", "deleted", "same", "inserted"]);
		expect([c.insertions, c.deletions]).toEqual([1, 1]);
	});

	it("marks only the words that changed inside an edited paragraph", () => {
		const c = compareLines(["The quick brown fox"], ["The slow brown fox"]);
		const row = c.rows[0];
		expect(row.kind).toBe("changed");
		const text = (k: string) => row.pieces.filter((p) => p.kind === k).map((p) => p.text.trim()).join(" ");
		expect(text("deletion")).toBe("quick");
		expect(text("insertion")).toBe("slow");
		expect(row.pieces.filter((p) => p.kind !== "insertion").map((p) => p.text).join("")).toBe("The quick brown fox");
		expect(row.pieces.filter((p) => p.kind !== "deletion").map((p) => p.text).join("")).toBe("The slow brown fox");
	});
});

// A small schema with the two marks the editor has
const schema = new Schema({
	nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", group: "block" }, text: { group: "inline" } },
	marks: { insertion: { attrs: { stringValue: { default: "" } } }, deletion: { attrs: { stringValue: { default: "" } } } },
});
const marked = (text: string, kind: "insertion" | "deletion" | null, value = "") => schema.text(text, kind ? [schema.marks[kind].create({ stringValue: value })] : []);
const para = (...parts: ReturnType<typeof marked>[]) => schema.node("doc", null, [schema.node("paragraph", null, parts)]);
const setOf = (...values: string[]) => {
	const map = new Y.Doc().getMap<boolean>("r");
	const set = resolvedSetOf(map);
	set.add(values);
	return set;
};

describe("marks left behind by a change that was resolved", () => {
	// w0 w1, a pending insertion by Z, then plain words that a merge has marked with Z's value as well
	const doc = para(marked("w0 w1", null), marked(" p1a", "insertion", "Z|d1"), marked(" w4 w5", "insertion", "Z|d1"), marked(" w6", "deletion", "Y|d2"));

	it("are found by their value, and nothing else is", () => {
		expect(strayMarks(doc, setOf("Z|d1")).map((s) => [s.kind, doc.textBetween(s.from, s.to)])).toEqual([["insertion", " p1a w4 w5"]]);
		expect(strayMarks(doc, setOf("other|d9"))).toEqual([]);
		expect(strayMarks(doc, setOf())).toEqual([]);
	});

	it("are removed by the plugin when it is asked to check, leaving the pending ones", () => {
		const store = newReviewStore("Ana", setOf("Z|d1"));
		const plugin = staleMarksPlugin(store);
		const state = EditorState.create({ schema, doc, plugins: [plugin] });
		const next = state.apply(state.tr.setMeta(plugin.spec.key as never, "check"));
		const left = changesOf(next.doc);
		expect(left.map((c) => [c.kind, c.text])).toEqual([["deletion", " w6"]]);
		expect(next.doc.textContent).toBe("w0 w1 p1a w4 w5 w6");
	});

	it("does nothing while no change has been resolved", () => {
		const store = newReviewStore("Ana", setOf());
		const plugin = staleMarksPlugin(store);
		const state = EditorState.create({ schema, doc, plugins: [plugin] });
		const next = state.apply(state.tr.setMeta(plugin.spec.key as never, "check"));
		expect(changesOf(next.doc)).toHaveLength(2);
	});

	it("keeps every value of a change that was typed in several goes", () => {
		const two = para(marked("a", "insertion", "Z|d1"), marked("b", "insertion", "Z|d2"));
		const [c] = changesOf(two);
		expect(c.values).toEqual(["Z|d1", "Z|d2"]);
	});
});

describe("the list of resolved changes", () => {
	it("reaches another device and tells it", () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		const sa = resolvedSetOf(a.getMap<boolean>("resolvedChanges"));
		const sb = resolvedSetOf(b.getMap<boolean>("resolvedChanges"));
		let told = 0;
		sb.watch(() => told++);
		sa.add(["Z|d1", "Z|d2"]);
		sa.add(["Z|d1"]); // already there: no second write
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
		expect([sb.has("Z|d1"), sb.has("Z|d2"), sb.has("Z|d3"), sb.size()]).toEqual([true, true, false, 2]);
		expect(told).toBe(1);
	});
});
