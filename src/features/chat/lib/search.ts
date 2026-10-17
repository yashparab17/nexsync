// Messages and comments as items for the workspace search (Ctrl+K): the words as they are now (the newest edit applied) and
// nothing that was deleted.

import { commentText, isThread, type LogEntry } from "@/features/chat/lib/entries";
import { decodeMentions, type Person } from "@/features/chat/lib/mentions";
import { plainPreview } from "@/features/chat/lib/preview";

export interface ChatHit {
	id: string;
	kind: "Message" | "Comment";
	channel: string;
	name: string; // Who wrote it
	ts: number;
	text: string; // Plain: mentions shown as @Name
}

export function chatHits(entries: LogEntry[], people: Person[]): ChatHit[] {
	const edits = new Map<string, LogEntry>();
	const deleted = new Set<string>();
	for (const e of entries) {
		if (e.kind === "edit") {
			const prior = edits.get(e.parent);
			if (!prior || e.ts >= prior.ts) edits.set(e.parent, e);
		} else if (e.kind === "delete") deleted.add(e.parent);
	}
	const out: ChatHit[] = [];
	for (const e of entries) {
		if ((e.kind !== "message" && e.kind !== "comment") || deleted.has(e.id)) continue;
		const body = edits.get(e.id)?.body ?? e.body;
		const raw = e.kind === "comment" ? commentText(body) : body;
		out.push({ id: e.id, kind: isThread(e.channel) || e.kind === "comment" ? "Comment" : "Message", channel: e.channel, name: e.name, ts: e.ts, text: decodeMentions(raw, people) });
	}
	return out.sort((a, b) => b.ts - a.ts);
}

// The short line a result shows
export const hitTitle = (hit: ChatHit, people: Person[]) => plainPreview(hit.text, people, 80);
