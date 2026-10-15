// Where a comment on a note or code file sits, and how it finds its way back after the text changes.
//
// A comment keeps three things: a Yjs relative position for each end of the commented words (it sticks to the characters
// themselves, not to a number), and the words. A relative position alone is right almost always while the characters are
// still there, but a moved line is deleted and typed again, so the characters are gone while the words are not. The words
// are therefore the way back: when the characters are gone, search for them. (Measured in RESEARCH.md §8l: a position
// number was on the wrong text in 51% of cases; a relative position lost every moved line; both together found them all.)

import * as Y from "yjs";

import type { Anchor } from "./entries";

// Where a comment is now: on its words, on words that were edited inside, found again elsewhere, or nowhere
export type Placement = { state: "on" | "changed" | "moved"; from: number; to: number } | { state: "orphaned" };

// Longer commented text is cut, so a comment on a whole file does not copy it
export const MAX_QUOTE = 300;

export function makeAnchor(ytext: Y.Text, from: number, to: number): Anchor | null {
	if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > ytext.length) return null;
	return {
		// The start sticks to the character after it, the end to the character before it, so text typed just outside stays outside
		from: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, from, 0)),
		to: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, to, -1)),
		quote: ytext.toString().slice(from, to).slice(0, MAX_QUOTE),
	};
}

const positionOf = (doc: Y.Doc, json: unknown): number | null => {
	try {
		return Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), doc)?.index ?? null;
	} catch {
		return null;
	}
};

function occurrences(text: string, quote: string): number[] {
	const out: number[] = [];
	if (!quote) return out;
	for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) out.push(i);
	return out;
}

export function locateAnchor(doc: Y.Doc, ytext: Y.Text, anchor: Anchor): Placement {
	const text = ytext.toString();
	const from = positionOf(doc, anchor.from);
	const to = positionOf(doc, anchor.to);
	const there = from !== null && to !== null && to > from && to <= text.length;
	if (there && text.slice(from, to) === anchor.quote.slice(0, to - from) && to - from === anchor.quote.length) return { state: "on", from, to };
	// The characters moved or were deleted: look for the words themselves, taking the one nearest where the comment was
	const found = occurrences(text, anchor.quote);
	if (found.length > 0) {
		const near = from ?? 0;
		const at = found.reduce((best, p) => (Math.abs(p - near) < Math.abs(best - near) ? p : best));
		return { state: "moved", from: at, to: at + anchor.quote.length };
	}
	// The words are not anywhere. If the characters are still there but were edited, the comment stays on them.
	if (there) return { state: "changed", from, to };
	return { state: "orphaned" };
}
