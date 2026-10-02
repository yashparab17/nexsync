import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as Y from "yjs";

import { openProposals, propose } from "@/lib/proposals";
import { proposalMarks } from "./proposalsView";

let view: EditorView | null = null;
afterEach(() => {
	view?.destroy();
	view = null;
});

function open(text: string, canEdit: boolean) {
	const doc = new Y.Doc();
	const ytext = doc.getText("content");
	ytext.insert(0, text);
	const parent = document.createElement("div");
	document.body.append(parent);
	view = new EditorView({ parent, state: EditorState.create({ doc: text, extensions: [proposalMarks(doc, ytext, "Kim", canEdit)] }) });
	return { doc, ytext, view };
}

describe("proposalMarks", () => {
	it("strikes through the words, shows the proposal and its author, and applies it on Accept", async () => {
		const { doc, ytext, view } = open("the quick fox", true);
		propose(doc, ytext, 4, 9, "slow", "Sam");
		await Promise.resolve();
		expect(view.dom.querySelector(".cm-proposal-old")?.textContent).toBe("quick");
		expect(view.dom.querySelector(".cm-proposal-new")?.textContent).toBe("slow");
		expect(view.dom.querySelector(".cm-proposal-by")?.textContent).toBe("Sam");

		(view.dom.querySelector('[data-action="accept"]') as HTMLButtonElement).click();
		expect(ytext.toString()).toBe("the slow fox");
		expect(openProposals(doc)).toHaveLength(0);
	});

	it("rejects without touching the text", async () => {
		const { doc, ytext, view } = open("the quick fox", true);
		propose(doc, ytext, 4, 9, "slow", "Sam");
		await Promise.resolve();
		(view.dom.querySelector('[data-action="reject"]') as HTMLButtonElement).click();
		expect(ytext.toString()).toBe("the quick fox");
		expect(openProposals(doc)).toHaveLength(0);
	});

	it("offers no buttons to someone who may not edit", async () => {
		const { doc, ytext, view } = open("the quick fox", false);
		propose(doc, ytext, 4, 9, "slow", "Sam");
		await Promise.resolve();
		expect(view.dom.querySelector(".cm-proposal-new")).toBeTruthy();
		expect(view.dom.querySelector("button")).toBeNull();
	});
});
