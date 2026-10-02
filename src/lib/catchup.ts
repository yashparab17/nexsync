// The catch-up review: what other people changed while this device was not looking, grouped by who did it, with a way to
// undo a single change. Undoing is never a rollback of shared state: it is a new edit of the field or the text, so it
// merges and reaches everyone like any other edit.

import type * as Y from "yjs";

import { diffLines, splitLines } from "@/lib/diff";
import type { CatchupEntry } from "@/types/workspace";

export const UNKNOWN_AUTHOR = "A collaborator";

export interface Lookups {
	member: (id: string) => string;
	column: (id: string) => string;
}

// How far a change's author can be trusted. A write names itself, which proves nothing; one signed with a device key proves
// the key, and a key that is on the member list is that member's.
export interface Author {
	name: string;
	// Signed with a device key
	signed: boolean;
	// Signed with the key of a member on the list, so the name is the list's and not the writer's own claim
	vouched: boolean;
}

export function authorOf(e: CatchupEntry, members: { name: string; deviceId?: string }[]): Author {
	const claimed = e.who?.trim() || UNKNOWN_AUTHOR;
	if (!e.signer) return { name: claimed, signed: false, vouched: false };
	const member = members.find((m) => m.deviceId === e.signer);
	return member ? { name: member.name, signed: true, vouched: true } : { name: claimed, signed: true, vouched: false };
}

export interface AuthorGroup {
	who: string;
	entries: CatchupEntry[];
	latest: number;
	signed: boolean;
	vouched: boolean;
}

// Most recent author first; within an author, newest change first (the list arrives newest first)
export function groupByAuthor(entries: CatchupEntry[], members: { name: string; deviceId?: string }[] = []): AuthorGroup[] {
	const groups = new Map<string, AuthorGroup>();
	for (const e of entries) {
		const author = authorOf(e, members);
		const group = groups.get(author.name) ?? { who: author.name, entries: [], latest: 0, signed: true, vouched: true };
		group.entries.push(e);
		group.latest = Math.max(group.latest, e.at);
		// A group is only as trusted as its least trusted change
		group.signed &&= author.signed;
		group.vouched &&= author.vouched;
		groups.set(author.name, group);
	}
	return [...groups.values()].sort((a, b) => b.latest - a.latest);
}

// What is reviewed as one item: all of a person's edits to one file are one, and every other change is its own
export const rowKey = (e: CatchupEntry) => (e.kind === "text" ? `text:${e.target}` : `entry:${e.id}`);

// The items of one person's changes, each holding the changes folded into it (newest first)
export function rowsOf(entries: CatchupEntry[]): CatchupEntry[][] {
	const rows = new Map<string, CatchupEntry[]>();
	for (const e of entries) rows.set(rowKey(e), [...(rows.get(rowKey(e)) ?? []), e]);
	return [...rows.values()];
}

// How many items there are to review, which is what a badge should count
export function countRows(entries: CatchupEntry[], members: { name: string; deviceId?: string }[] = []): number {
	return groupByAuthor(entries, members).reduce((n, g) => n + rowsOf(g.entries).length, 0);
}

// One line of what a text change added, for the folded view
export function previewText(e: CatchupEntry, max = 90): string {
	if (e.before === null || e.after === null) return "A large change";
	const added = textHunks(e.before, e.after)
		.flatMap((h) => h.newLines)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	if (!added) return "Removed text";
	return added.length > max ? `${added.slice(0, max - 1)}…` : added;
}

// A value from the journal, which holds JSON text; anything unreadable is treated as no value
export function parseValue(json: string | null): unknown {
	if (json === null) return undefined;
	try {
		return JSON.parse(json);
	} catch {
		return undefined;
	}
}

const FIELD_NAMES: Record<string, string> = {
	title: "title",
	description: "description",
	status: "status",
	priority: "priority",
	due_date: "due date",
	assignee_id: "assignee",
	column_id: "list",
};

const short = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function shownValue(path: string, value: unknown, look: Lookups): string {
	if (value === undefined || value === null || value === "") return "nothing";
	if (path === "assignee_id") return look.member(String(value));
	if (path === "column_id") return look.column(String(value));
	if (path === "description") return short(String(value), 40);
	return short(typeof value === "string" ? value : JSON.stringify(value));
}

// One line saying what changed, in words
export function describe(e: CatchupEntry, look: Lookups): string {
	const name = `"${short(e.label, 40)}"`;
	if (e.kind === "created") return `Added ${name}`;
	if (e.kind === "deleted") return `Deleted ${name}`;
	if (e.kind === "text") return `Edited ${e.label}`;

	const before = parseValue(e.before);
	const after = parseValue(e.after);
	if (e.path.startsWith("tags/")) return `${after === undefined ? "Removed" : "Added"} the tag "${e.path.slice(5)}" ${after === undefined ? "from" : "to"} ${name}`;
	if (e.path.startsWith("comments/")) {
		if (after === undefined) return `Removed a comment on ${name}`;
		const text = typeof (after as { text?: unknown })?.text === "string" ? (after as { text: string }).text : "";
		return `Commented on ${name}: ${short(text, 50)}`;
	}
	const checklist = e.path.match(/^checklist\/([^/]+)(?:\/(text|done))?$/);
	if (checklist) {
		if (checklist[2] === "done") return `${after === true ? "Ticked" : "Unticked"} a checklist item on ${name}`;
		if (checklist[2] === "text") return `Reworded a checklist item on ${name}: ${shownValue(e.path, after, look)}`;
		return `${after === undefined ? "Removed" : "Added"} a checklist item ${after === undefined ? "from" : "to"} ${name}`;
	}
	const field = FIELD_NAMES[e.path] ?? e.path;
	return `Changed the ${field} of ${name} from ${shownValue(e.path, before, look)} to ${shownValue(e.path, after, look)}`;
}

// A field change can be undone by writing the old value back; a record added or deleted, or text, is handled elsewhere
export function canRevertField(e: CatchupEntry): boolean {
	return e.kind === "field" && e.state === "new";
}

// The value to write to undo a field change; null removes a tag, comment or checklist item, or clears a field
export function revertValue(e: CatchupEntry): unknown {
	const before = parseValue(e.before);
	return before === undefined ? null : before;
}

// ────────────────────────────
// Text
// ────────────────────────────

// One run of changed lines, with enough of the new text around it to find it again after later edits
export interface TextHunk {
	oldLines: string[];
	newLines: string[];
	// Up to two unchanged lines either side, as they stand in the new text
	above: string[];
	below: string[];
}

const CONTEXT = 2;

export function textHunks(before: string, after: string): TextHunk[] {
	const { rows } = diffLines(before, after);
	const newLines = splitLines(after);
	const hunks: TextHunk[] = [];
	let newIndex = 0; // The next line of the new text
	for (let i = 0; i < rows.length; ) {
		if (rows[i].kind === "same") {
			newIndex++;
			i++;
			continue;
		}
		const start = newIndex;
		const hunk: TextHunk = { oldLines: [], newLines: [], above: [], below: [] };
		while (i < rows.length && rows[i].kind !== "same") {
			if (rows[i].kind === "del") hunk.oldLines.push(rows[i].text);
			else {
				hunk.newLines.push(rows[i].text);
				newIndex++;
			}
			i++;
		}
		hunk.above = newLines.slice(Math.max(0, start - CONTEXT), start);
		hunk.below = newLines.slice(newIndex, newIndex + CONTEXT);
		hunks.push(hunk);
	}
	return hunks;
}

function matchesAt(lines: string[], at: number, wanted: string[]): boolean {
	return at >= 0 && at + wanted.length <= lines.length && wanted.every((line, k) => lines[at + k] === line);
}

// The text with one hunk undone, or null when it can no longer be found exactly once (it was edited since, or the
// text around it moved) or the text uses Windows line endings, which would turn the edit into a rewrite of every line.
// A hunk at the very start or end of the file has no context on that side, so it must still be at the start or end.
export function revertHunk(current: string, hunk: TextHunk): string | null {
	if (current.includes("\r")) return null;
	const lines = splitLines(current);
	const wanted = [...hunk.above, ...hunk.newLines, ...hunk.below];
	const found: number[] = [];
	for (let at = 0; at + wanted.length <= lines.length; at++) {
		if (!matchesAt(lines, at, wanted)) continue;
		if (hunk.above.length === 0 && at !== 0) continue;
		if (hunk.below.length === 0 && at + wanted.length !== lines.length) continue;
		found.push(at);
	}
	if (found.length !== 1) return null;
	const from = found[0] + hunk.above.length;
	const out = [...lines.slice(0, from), ...hunk.oldLines, ...lines.slice(from + hunk.newLines.length)];
	const body = out.join("\n");
	return out.length > 0 && current.endsWith("\n") ? `${body}\n` : body;
}

// Makes the text read `next` by changing only the stretch that differs, so the rest keeps its history and cursors
export function replaceText(text: Y.Text, next: string): void {
	const cur = text.toString();
	let start = 0;
	while (start < cur.length && start < next.length && cur[start] === next[start]) start++;
	let end = 0;
	while (end < cur.length - start && end < next.length - start && cur[cur.length - 1 - end] === next[next.length - 1 - end]) end++;
	// Never cut a character that is two UTF-16 units in half
	if (start > 0 && cur.charCodeAt(start - 1) >= 0xd800 && cur.charCodeAt(start - 1) <= 0xdbff) start--;
	if (end > 0 && cur.charCodeAt(cur.length - end) >= 0xdc00 && cur.charCodeAt(cur.length - end) <= 0xdfff) end--;
	const apply = () => {
		if (cur.length - start - end > 0) text.delete(start, cur.length - start - end);
		const insert = next.slice(start, next.length - end);
		if (insert) text.insert(start, insert);
	};
	if (text.doc) text.doc.transact(apply);
	else apply();
}
