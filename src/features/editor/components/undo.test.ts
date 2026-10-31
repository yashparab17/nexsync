import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";

// Undo has to survive the editor's extensions being rebuilt (a comment or suggestion arriving does that)
describe("shared-text undo", () => {
	it("keeps its history when yCollab is configured again with the same manager", () => {
		const doc = new Y.Doc();
		const text = doc.getText("content");
		const awareness = new Awareness(doc);
		const undoManager = new Y.UndoManager(text);
		const slot = new Compartment();
		const build = () => [yCollab(text, awareness, { undoManager }), keymap.of(yUndoManagerKeymap)];
		const view = new EditorView({ state: EditorState.create({ doc: "", extensions: [slot.of(build())] }), parent: document.body });
		view.dispatch({ changes: { from: 0, insert: "hello" } });
		expect(text.toString()).toBe("hello");
		view.dispatch({ effects: slot.reconfigure(build()) });
		runScopeHandlers(view, new KeyboardEvent("keydown", { key: "z", ctrlKey: true }), "editor");
		expect(text.toString()).toBe("");
		runScopeHandlers(view, new KeyboardEvent("keydown", { key: "y", ctrlKey: true }), "editor");
		expect(text.toString()).toBe("hello");
		view.destroy();
	});
});
