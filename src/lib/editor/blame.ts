// Who wrote which lines of a shared file, read from the Yjs document itself.
//
// Every character in a Yjs text remembers the client (one editing session on one device) that typed it.
// The document also keeps a small map from client to person, filled in when someone first edits, so the
// history needs no extra storage and travels with the document to every collaborator.

import * as Y from "yjs";

const AUTHORS = "authors";
const UNKNOWN = "Unknown";

export interface AuthorInfo {
	name: string;
	at: number; // Milliseconds since the Unix epoch of that session first edit
}

export interface BlameRange {
	author: string;
	from: number; // 1-based line numbers, inclusive
	to: number;
}

export interface Contribution {
	author: string;
	chars: number;
	lines: number;
	percent: number; // Share of the current characters
	lastEdit: number | null;
}

// Remembers who this editing session belongs to; call when the person edits
export function recordAuthor(doc: Y.Doc, name: string) {
	const authors = doc.getMap<AuthorInfo>(AUTHORS);
	const key = String(doc.clientID);
	if (authors.get(key)?.name !== name) authors.set(key, { name, at: Date.now() });
}

// Starts recording the author on this device first local edit to the document; returns a function that stops it
export function trackAuthor(doc: Y.Doc, name: string): () => void {
	const handler = (_update: Uint8Array, _origin: unknown, _doc: Y.Doc, tr: Y.Transaction) => {
		if (tr.local && doc.getMap(AUTHORS).get(String(doc.clientID)) === undefined) recordAuthor(doc, name);
	};
	doc.on("update", handler);
	return () => doc.off("update", handler);
}

interface Item {
	deleted: boolean;
	right: Item | null;
	id: { client: number };
	content: { str?: string };
}

// The client that wrote each character of the text, in order
function ownersOf(ytext: Y.Text): number[] {
	const owners: number[] = [];
	// Reads Yjs internals: the text is a linked list of items, and each remembers the client id of its writer.
	let item = (ytext as unknown as { _start: Item | null })._start;
	for (; item; item = item.right) {
		const str = item.deleted ? undefined : item.content.str;
		if (str === undefined) continue;
		for (let i = 0; i < str.length; i++) owners.push(item.id.client);
	}
	return owners;
}

function nameFor(authors: Y.Map<AuthorInfo>, client: number): string {
	return authors.get(String(client))?.name ?? UNKNOWN;
}

// The author of each line, taken as whoever wrote most of its characters
export function blameLines(ytext: Y.Text, authors: Y.Map<AuthorInfo>): string[] {
	const text = ytext.toString();
	const owners = ownersOf(ytext);
	if (owners.length !== text.length) return [];
	const lines: string[] = [];
	let start = 0;
	for (const line of text.split("\n")) {
		const counts = new Map<string, number>();
		// An empty line belongs to whoever pressed Enter
		const end = line.length === 0 ? start + 1 : start + line.length;
		for (let i = start; i < end && i < owners.length; i++) {
			const name = nameFor(authors, owners[i]);
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}
		lines.push([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? lines[lines.length - 1] ?? UNKNOWN);
		start += line.length + 1;
	}
	// A trailing newline leaves an empty last line that nobody wrote
	if (text.endsWith("\n")) lines.pop();
	return lines;
}

// Consecutive lines by the same author, for a compact blame list
export function blameRanges(lines: string[]): BlameRange[] {
	const ranges: BlameRange[] = [];
	lines.forEach((author, i) => {
		const last = ranges[ranges.length - 1];
		if (last && last.author === author) last.to = i + 1;
		else ranges.push({ author, from: i + 1, to: i + 1 });
	});
	return ranges;
}

// How much of the current file each person wrote
export function contributions(ytext: Y.Text, authors: Y.Map<AuthorInfo>): Contribution[] {
	const owners = ownersOf(ytext);
	if (owners.length !== ytext.length) return [];
	const byName = new Map<string, Contribution>();
	const lastEdits = new Map<string, number>();
	authors.forEach((info) => lastEdits.set(info.name, Math.max(lastEdits.get(info.name) ?? 0, info.at)));
	for (const client of owners) {
		const author = nameFor(authors, client);
		const entry = byName.get(author) ?? { author, chars: 0, lines: 0, percent: 0, lastEdit: lastEdits.get(author) ?? null };
		entry.chars++;
		byName.set(author, entry);
	}
	for (const author of blameLines(ytext, authors)) {
		const entry = byName.get(author);
		if (entry) entry.lines++;
	}
	const total = owners.length || 1;
	return [...byName.values()]
		.map((c) => ({ ...c, percent: Math.round((c.chars / total) * 100) }))
		.sort((a, b) => b.chars - a.chars);
}
