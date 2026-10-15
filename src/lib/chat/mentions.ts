// Mentions in the log are stored as `<@device key>`, so they name exactly one device whatever the display names are. People
// type and read `@Name`: this turns one into the other.

export interface Person {
	name: string;
	deviceId?: string;
}

const TOKEN = /<@([A-Za-z0-9]+)>/g;

// `@Name` in typed text becomes `<@key>` for each name that belongs to a member with a device key. The longest names are
// matched first, so "@Ana Maria" is not read as "@Ana". A name that matches nobody is left as it was typed.
export function encodeMentions(text: string, people: Person[]): string {
	const known = people.filter((p) => p.deviceId && p.name).sort((a, b) => b.name.length - a.name.length);
	let out = text;
	for (const p of known) {
		const escaped = p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		out = out.replace(new RegExp(`(^|[^\\w<])@${escaped}(?![\\w])`, "gi"), (_m, lead: string) => `${lead}<@${p.deviceId}>`);
	}
	return out;
}

export interface Piece {
	text: string;
	mention: boolean;
	/** The device key a mention names */
	key?: string;
}

// The text split into plain pieces and mentions, with each mention shown as `@Name` (or `@someone` for a key not in the list)
export function splitMentions(text: string, people: Person[]): Piece[] {
	const out: Piece[] = [];
	let last = 0;
	for (const m of text.matchAll(TOKEN)) {
		const at = m.index ?? 0;
		if (at > last) out.push({ text: text.slice(last, at), mention: false });
		const who = people.find((p) => p.deviceId === m[1]);
		out.push({ text: `@${who?.name ?? "someone"}`, mention: true, key: m[1] });
		last = at + m[0].length;
	}
	if (last < text.length) out.push({ text: text.slice(last), mention: false });
	return out;
}

// Whether the text mentions this device
export const mentions = (text: string, key: string): boolean => !!key && text.includes(`<@${key}>`);

// The word being typed after an `@`, or null when the caret is not in one
export function mentionQuery(text: string, caret: number): { query: string; start: number } | null {
	const before = text.slice(0, caret);
	const m = /(^|\s)@([^\s@<>]{0,30})$/.exec(before);
	if (!m) return null;
	return { query: m[2], start: caret - m[2].length - 1 };
}

// Members whose names start with what was typed, best first
export function mentionMatches(query: string, people: Person[], limit = 6): Person[] {
	const q = query.toLowerCase();
	return people
		.filter((p) => p.deviceId && p.name.toLowerCase().startsWith(q))
		.sort((a, b) => a.name.localeCompare(b.name))
		.slice(0, limit);
}

// Replaces the `@query` being typed with `@Name ` so the name can be turned into a mention when the message is sent
export function completeMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
	const next = `${text.slice(0, start)}@${name} ${text.slice(caret)}`;
	return { text: next, caret: start + name.length + 2 };
}

// `<@key>` shown as `@Name`, for putting a message back into the box to edit it
export function decodeMentions(text: string, people: Person[]): string {
	return text.replace(TOKEN, (_m, key: string) => `@${people.find((p) => p.deviceId === key)?.name ?? "someone"}`);
}
