import * as Y from "yjs";
import { describe, expect, it } from "vitest";

// What a note's saved Yjs state keeps after text is typed and deleted (RESEARCH.md §8g). The app saves the whole state of
// each document as one value, not a log of updates, so the questions are whether deleted words survive in it and how
// large it grows with the number of edits.

const MARKER = "ZEBRA-7731-MARKER";
const has = (bytes: Uint8Array, text: string) => new TextDecoder("latin1").decode(bytes).includes(text);

// A small deterministic generator, so a number can be reproduced
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

function typeAndDelete(edits: number, gc: boolean) {
	const doc = new Y.Doc({ gc });
	const text = doc.getText("content");
	const rand = rng(11);
	text.insert(0, "start of the note\n");
	for (let i = 0; i < edits; i++) {
		if (text.length > 400 && rand() < 0.5) text.delete(Math.floor(rand() * (text.length - 10)), 1 + Math.floor(rand() * 8));
		else text.insert(Math.floor(rand() * (text.length + 1)), "abcdefghij".slice(0, 1 + Math.floor(rand() * 6)));
	}
	// The words to be deleted are typed last, whole, so they are one run in the saved state
	text.insert(text.length, `${MARKER} end\n`);
	return { doc, text };
}

describe("what a note's saved Yjs state keeps", () => {
	it("drops the words of deleted text, which is the default, and keeps them if garbage collection is switched off", () => {
		for (const gc of [true, false]) {
			const { doc, text } = typeAndDelete(50, gc);
			const at = text.toString().indexOf(MARKER);
			text.delete(at, MARKER.length);
			expect(text.toString()).not.toContain(MARKER);
			const kept = has(Y.encodeStateAsUpdate(doc), MARKER);
			console.log(`deleted words in the saved state, garbage collection ${gc ? "on (the app's setting)" : "off"}: ${kept ? "still there" : "gone"}`);
			expect(kept).toBe(!gc);
		}
	});

	it("keeps deleted words in a branch made before the deletion, as a copy of the history", () => {
		const { doc, text } = typeAndDelete(50, true);
		const branch = new Y.Doc();
		Y.applyUpdate(branch, Y.encodeStateAsUpdate(doc));
		text.delete(text.toString().indexOf(MARKER), MARKER.length);
		expect(has(Y.encodeStateAsUpdate(doc), MARKER)).toBe(false);
		expect(has(Y.encodeStateAsUpdate(branch), MARKER)).toBe(true);
	});

	it("grows with the edits but far less than the text typed, and a fresh copy of the state is no smaller", () => {
		const rows: string[] = [];
		for (const edits of [1_000, 10_000]) {
			const { doc, text } = typeAndDelete(edits, true);
			const state = Y.encodeStateAsUpdate(doc);
			const fresh = new Y.Doc();
			Y.applyUpdate(fresh, state);
			const again = Y.encodeStateAsUpdate(fresh);
			rows.push(`${edits} edits: ${text.length} characters of text, saved state ${state.length} bytes, after loading and saving again ${again.length} bytes`);
			expect(again.length).toBeLessThanOrEqual(state.length);
			expect(state.length).toBeLessThan(edits * 40);
		}
		console.log(rows.join("\n"));
	});
});
