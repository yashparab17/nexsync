// Comments on tasks and cards, and the @mentions inside them

import type { Comment } from "@/types/workspace";

export const MAX_COMMENT_LENGTH = 2000;

// Names are matched longest first, so "@Ann Lee" is not read as a mention of "Ann"
const byLength = (names: string[]) => [...names].filter(Boolean).sort((a, b) => b.length - a.length);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A name is mentioned as "@Name" when no letter or digit follows it
function mentionPattern(names: string[]): RegExp | null {
	const sorted = byLength(names);
	return sorted.length ? new RegExp(`@(${sorted.map(escape).join("|")})(?![\\p{L}\\p{N}_])`, "giu") : null;
}

export interface Segment {
	text: string;
	mention: boolean;
}

// The text split into plain parts and mentions of the given people, for highlighting
export function splitMentions(text: string, names: string[]): Segment[] {
	const pattern = mentionPattern(names);
	if (!pattern) return [{ text, mention: false }];
	const out: Segment[] = [];
	let last = 0;
	for (const m of text.matchAll(pattern)) {
		if (m.index > last) out.push({ text: text.slice(last, m.index), mention: false });
		out.push({ text: m[0], mention: true });
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ text: text.slice(last), mention: false });
	return out;
}

// Whether the comment mentions this person
export function mentions(text: string, name: string): boolean {
	return splitMentions(text, [name]).some((s) => s.mention);
}

// Comments in `after` that were not in `before` and mention `me`, written by someone else
export function newMentions(before: Comment[] | undefined, after: Comment[] | undefined, me: string): Comment[] {
	const seen = new Set((before ?? []).map((c) => c.id));
	return (after ?? []).filter((c) => !seen.has(c.id) && c.author !== me && mentions(c.text, me));
}

// A new comment, or null when the text is empty
export function makeComment(text: string, author: string, now = new Date(), id: string = crypto.randomUUID()): Comment | null {
	const clean = text.trim().slice(0, MAX_COMMENT_LENGTH);
	return clean ? { id, author, text: clean, at: now.toISOString() } : null;
}

// The people whose names start with what follows the last "@" in the text, for completing a mention
export function mentionSuggestions(text: string, names: string[]): string[] {
	const at = text.lastIndexOf("@");
	if (at < 0 || (at > 0 && !/\s/.test(text[at - 1]))) return [];
	const typed = text.slice(at + 1).toLowerCase();
	if (typed.includes("\n")) return [];
	return names.filter((n) => n.toLowerCase().startsWith(typed) && n.toLowerCase() !== typed).slice(0, 5);
}

// The text with the "@part" being typed completed to a whole name
export function completeMention(text: string, name: string): string {
	return `${text.slice(0, text.lastIndexOf("@"))}@${name} `;
}
