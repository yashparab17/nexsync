import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { pagePushPlugin } from "./pagePush";

// The shape the editor gives its blocks: a group of blocks, each with an id around one paragraph
const schema = new Schema({
	nodes: {
		doc: { content: "blockGroup" },
		blockGroup: { content: "blockContainer+" },
		blockContainer: { content: "paragraph", attrs: { id: { default: "" } } },
		paragraph: { content: "text*", toDOM: () => ["p", 0] },
		text: { group: "inline" },
	},
});
const block = (id: string, text: string) => schema.nodes.blockContainer.create({ id }, schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined));
const start = () => EditorState.create({ schema, doc: schema.nodes.doc.create(null, schema.nodes.blockGroup.create(null, [block("a", "one"), block("b", "two"), block("c", "three")])), plugins: [pagePushPlugin] });
const pushed = (s: EditorState) => pagePushPlugin.getState(s)!;
const decorated = (s: EditorState) => pushed(s).set.find().length;

describe("pagePush", () => {
	const pushB = () => start().apply(start().tr.setMeta("pagePush", { push: [0, 200, 0], split: [null, null, null] }));

	it("keeps a block pushed to the next page through typing in it", () => {
		const s = pushB();
		const next = s.apply(s.tr.insertText("x", 11)); // inside "two"
		expect(pushed(next).push).toEqual([0, 200, 0]);
		expect(decorated(next)).toBe(1);
	});

	it("keeps the push on a block that Enter splits in two, on the first half only", () => {
		const s = pushB();
		const next = s.apply(s.tr.split(13, 2)); // Enter at the end of "two"
		expect(pushed(next).ids.length).toBe(4);
		expect(decorated(next)).toBe(1);
		expect(pushed(next).push.filter((p) => p > 0)).toEqual([200]);
		expect(pushed(next).push[1]).toBe(200);
	});

	it("keeps the push with its block when a block is added before it", () => {
		const s = pushB();
		const next = s.apply(s.tr.insert(1, block("z", "new")));
		expect(pushed(next).ids).toEqual(["z", "a", "b", "c"]);
		expect(pushed(next).push).toEqual([0, 0, 200, 0]);
	});
});
