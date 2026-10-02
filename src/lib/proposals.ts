// Suggested edits inside a text, kept in the file's own shared document.
//
// A suggestion says "replace this part with that" without changing the text. Its two ends are Yjs relative positions,
// which stick to the characters themselves, so the suggestion stays on the same words while other people type before,
// after or inside it. The list is a map in the document ("proposals"), so it reaches everyone who has the file, is stored
// with it, and needs no server. Accepting one is an ordinary edit of the text; rejecting it only closes it.

import * as Y from "yjs";

export type ProposalStatus = "open" | "accepted" | "rejected";

export interface Proposal {
	id: string;
	by: string;
	at: number; // Milliseconds since 1970
	from: unknown; // Relative position (JSON) of the start of the text to replace
	to: unknown; // Relative position of its end
	original: string; // The text the author saw there, to notice when it has been changed since
	text: string; // What the author wants there instead
	status: ProposalStatus;
	closedBy?: string;
	closedAt?: number;
}

export const MAX_PROPOSAL_TEXT = 20_000;
export const MAX_OPEN = 200;

const mapOf = (doc: Y.Doc) => doc.getMap<Proposal>("proposals");

// The map is shared, so what is in it came from other people's devices
function isProposal(value: unknown): value is Proposal {
	const p = value as Partial<Proposal> | null;
	return (
		!!p &&
		typeof p.id === "string" &&
		typeof p.by === "string" &&
		typeof p.at === "number" &&
		typeof p.original === "string" &&
		typeof p.text === "string" &&
		p.text.length <= MAX_PROPOSAL_TEXT &&
		!!p.from &&
		!!p.to &&
		(p.status === "open" || p.status === "accepted" || p.status === "rejected")
	);
}

export function listProposals(doc: Y.Doc): Proposal[] {
	return [...mapOf(doc).values()].filter(isProposal).sort((a, b) => b.at - a.at);
}

export const openProposals = (doc: Y.Doc) => listProposals(doc).filter((p) => p.status === "open");

// Proposes replacing `from` to `to` (indexes into the text) with `text`; an empty range proposes an insertion
export function propose(doc: Y.Doc, ytext: Y.Text, from: number, to: number, text: string, by: string, id: string = crypto.randomUUID(), now = Date.now()): Proposal {
	if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > ytext.length) throw new Error("That part of the text is not there any more.");
	if (text.length > MAX_PROPOSAL_TEXT) throw new Error("That suggestion is too long.");
	const original = ytext.toString().slice(from, to);
	if (text === original) throw new Error("The suggestion is the same as the text.");
	if (openProposals(doc).length >= MAX_OPEN) throw new Error("There are too many open suggestions in this file. Settle some first.");
	// The end sticks to the character before it, so text typed right after the range stays outside it; an insertion has
	// no characters of its own, so both of its ends stick the same way
	const proposal: Proposal = {
		id,
		by,
		at: now,
		from: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, from, 0)),
		to: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, to, from === to ? 0 : -1)),
		original,
		text,
		status: "open",
	};
	mapOf(doc).set(id, proposal);
	return proposal;
}

// Where the suggestion sits in the text now, or null when it cannot be placed
export function locate(doc: Y.Doc, p: Proposal): { from: number; to: number } | null {
	try {
		const from = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(p.from), doc);
		const to = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(p.to), doc);
		if (!from || !to) return null;
		return { from: Math.min(from.index, to.index), to: Math.max(from.index, to.index) };
	} catch {
		return null;
	}
}

// Whether the words under the suggestion are still the ones its author saw
export function isCurrent(doc: Y.Doc, ytext: Y.Text, p: Proposal): boolean {
	const at = locate(doc, p);
	return !!at && ytext.toString().slice(at.from, at.to) === p.original;
}

export type Outcome = "applied" | "changed" | "gone";

// Puts the suggested text in. When the words under it have been changed since, nothing happens unless `force` says to
// go ahead, because the author never saw what it would replace.
export function accept(doc: Y.Doc, ytext: Y.Text, id: string, by: string, force = false, now = Date.now()): Outcome {
	const p = mapOf(doc).get(id);
	if (!p || !isProposal(p) || p.status !== "open") return "gone";
	const at = locate(doc, p);
	if (!at) return "gone";
	if (!force && ytext.toString().slice(at.from, at.to) !== p.original) return "changed";
	doc.transact(() => {
		if (at.to > at.from) ytext.delete(at.from, at.to - at.from);
		if (p.text) ytext.insert(at.from, p.text);
		mapOf(doc).set(id, { ...p, status: "accepted", closedBy: by, closedAt: now });
	});
	return "applied";
}

export function reject(doc: Y.Doc, id: string, by: string, now = Date.now()): boolean {
	const p = mapOf(doc).get(id);
	if (!p || !isProposal(p) || p.status !== "open") return false;
	mapOf(doc).set(id, { ...p, status: "rejected", closedBy: by, closedAt: now });
	return true;
}
