import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { FIRST, lockedSectionsPlugin, newLockStore, sectionAt, sectionRanges } from "@/features/office/documents/lib/documentLocks";

const schema = new Schema({
	nodes: {
		doc: { content: "blockGroup" },
		blockGroup: { content: "blockContainer+" },
		blockContainer: { content: "paragraph", attrs: { id: { default: "" } } },
		paragraph: { content: "text*", attrs: { sectionBreak: { default: "" } } },
		text: {},
	},
});
// One, Two | (section b) Three, Four | (section c) Five
const block = (id: string, text: string, brk = "") => schema.node("blockContainer", { id }, schema.node("paragraph", { sectionBreak: brk }, [schema.text(text)]));
const docOf = () => schema.node("doc", null, schema.node("blockGroup", null, [block("1", "One"), block("2", "Two"), block("b", "Three", "next|p||1"), block("4", "Four"), block("c", "Five", "next|p||1")]));

describe("locked sections", () => {
	it("finds the sections and which one a place is in", () => {
		const ranges = sectionRanges(docOf());
		expect(ranges.map((r) => r.key)).toEqual([FIRST, "b", "c"]);
		const at = (text: string) => {
			let found = -1;
			docOf().descendants((n, pos) => {
				if (n.isText && n.text === text) found = pos;
			});
			return sectionAt(ranges, found)?.key;
		};
		expect([at("Two"), at("Four"), at("Five")]).toEqual([FIRST, "b", "c"]);
	});

	const attempt = (locked: string[], isAdmin: boolean, where: string) => {
		const store = newLockStore();
		store.locked = new Set(locked);
		store.isAdmin = isAdmin;
		let refused = 0;
		store.onRefused = () => refused++;
		const state = EditorState.create({ doc: docOf(), plugins: [lockedSectionsPlugin(store)] });
		let pos = -1;
		state.doc.descendants((n, p) => {
			if (n.isText && n.text === where) pos = p + 1;
		});
		const next = state.apply(state.tr.insertText("X", pos));
		return { changed: next.doc.textContent !== state.doc.textContent, refused };
	};

	it("refuses an edit inside a locked section, and counts it", () => {
		expect(attempt(["b"], false, "Four")).toEqual({ changed: false, refused: 1 });
		expect(attempt([FIRST], false, "One")).toEqual({ changed: false, refused: 1 });
	});

	it("lets the other sections be edited", () => {
		expect(attempt(["b"], false, "Two")).toEqual({ changed: true, refused: 0 });
		expect(attempt(["b"], false, "Five")).toEqual({ changed: true, refused: 0 });
	});

	it("never stops an Owner or Admin", () => {
		expect(attempt(["b"], true, "Four")).toEqual({ changed: true, refused: 0 });
	});
});
