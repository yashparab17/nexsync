// The little bit of formatting a message may have: **bold**, *italic*, `code`, fenced code blocks, [[Note]] links and mentions.
// Anything else is plain text, so a message can never put markup or script on the page.

import { splitMentions, type Person } from "./mentions";

export type Inline =
	| { type: "text"; text: string }
	| { type: "bold"; text: string }
	| { type: "italic"; text: string }
	| { type: "code"; text: string }
	| { type: "mention"; text: string; key: string }
	| { type: "note"; text: string }
	| { type: "ref"; entity: "task" | "card"; id: string }
	| { type: "file"; path: string }; // An attachment, kept in the workspace's assets/chat folder

export type Block = { type: "code"; text: string; lang: string } | { type: "text"; inline: Inline[] };

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[\[[^\]\n]+\]\])/g;

function inlineOf(text: string, people: Person[]): Inline[] {
	const out: Inline[] = [];
	// Mentions are found first, so a name with a star in it is not read as formatting
	for (const piece of splitMentions(text, people)) {
		if (piece.mention) {
			out.push({ type: "mention", text: piece.text, key: piece.key ?? "" });
			continue;
		}
		let last = 0;
		for (const m of piece.text.matchAll(INLINE)) {
			const at = m.index ?? 0;
			if (at > last) out.push({ type: "text", text: piece.text.slice(last, at) });
			if (m[1]) out.push({ type: "code", text: m[1].slice(1, -1) });
			else if (m[2]) out.push({ type: "bold", text: m[2].slice(2, -2) });
			else if (m[3]) out.push({ type: "italic", text: m[3].slice(1, -1) });
			else {
				const name = m[4].slice(2, -2);
				const ref = /^(task|card):([\w-]+)$/.exec(name);
				const file = /^file:(assets\/chat\/[\w.-]+)$/.exec(name);
				if (file) out.push({ type: "file", path: file[1] });
				else out.push(ref ? { type: "ref", entity: ref[1] as "task" | "card", id: ref[2] } : { type: "note", text: name });
			}
			last = at + m[0].length;
		}
		if (last < piece.text.length) out.push({ type: "text", text: piece.text.slice(last) });
	}
	return out;
}

export function parseMessage(text: string, people: Person[]): Block[] {
	const out: Block[] = [];
	let last = 0;
	for (const m of text.matchAll(/```(\w*)\n?([\s\S]*?)```/g)) {
		const at = m.index ?? 0;
		if (at > last) out.push({ type: "text", inline: inlineOf(text.slice(last, at), people) });
		out.push({ type: "code", text: m[2].replace(/\n$/, ""), lang: m[1] });
		last = at + m[0].length;
	}
	if (last < text.length || out.length === 0) out.push({ type: "text", inline: inlineOf(text.slice(last), people) });
	return out.filter((b) => b.type === "code" || b.inline.length > 0);
}
