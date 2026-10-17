// What a person sees, worked out from the signed log of entries (see src-tauri/src/commands/workspace/chatlog.rs).
//
// The log only ever grows. An edit, a deletion, a reaction or a resolved thread is a new entry that points at an older one,
// so this file turns the raw entries into channels, messages with their edits and reactions, and comment threads. It is a
// pure function of the entries: two devices holding the same entries show the same thing.
//
// The Rust side has already refused entries from people who may not write, so edits and deletions found here are valid.

export type EntryKind = "message" | "edit" | "delete" | "react" | "unreact" | "channel" | "comment" | "resolve" | "reopen" | "dm" | "icon" | "profile" | "devenv" | "devrun" | "devrepro" | "announce" | "announce_end" | "ack" | "expire" | "moderation";

export interface LogEntry {
	id: string;
	kind: EntryKind;
	channel: string; // "general", another channel, or a thread: "doc:<path>", "task:<id>", "card:<id>"
	parent: string; // The entry it answers, edits, deletes, reacts to or resolves; empty for a new message or comment
	author: string; // Device key
	name: string;
	ts: number;
	body: string;
	sig: string;
}

export const GENERAL = "general";

// A thread on a file, task or card has a colon in its id; chat channels never do
export const isThread = (channel: string) => channel.includes(":");

export const docChannel = (path: string) => `doc:${path}`;
export const itemChannel = (entity: "task" | "card", id: string) => `${entity}:${id}`;

// ── channels ──

export interface Channel {
	id: string;
	name: string;
	topic: string;
	archived: boolean;
	slowSeconds: number; // Seconds an Editor must wait between messages; 0 for none
}

// The slug used as a channel id: lower case letters, digits and dashes
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}

const asRecord = (text: string): Record<string, unknown> => {
	try {
		const value = JSON.parse(text);
		return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	} catch {
		return {};
	}
};

// General always exists. Any other channel is made by an entry of kind "channel"; the newest entry for it sets its name,
// topic and whether it is archived.
export function buildChannels(entries: LogEntry[]): Channel[] {
	const made = new Map<string, LogEntry>();
	for (const e of entries) {
		if (e.kind !== "channel" || isThread(e.channel)) continue;
		const prior = made.get(e.channel);
		if (!prior || e.ts >= prior.ts) made.set(e.channel, e);
	}
	const out: Channel[] = [{ id: GENERAL, name: "general", topic: "Everyone in the workspace", archived: false, slowSeconds: 0 }];
	for (const [id, e] of made) {
		const body = asRecord(e.body);
		if (id === GENERAL) {
			out[0].slowSeconds = typeof body.slowSeconds === "number" ? body.slowSeconds : 0;
			continue;
		}
		out.push({ id, name: typeof body.name === "string" && body.name ? body.name : id, topic: typeof body.topic === "string" ? body.topic : "", archived: body.archived === true, slowSeconds: typeof body.slowSeconds === "number" ? body.slowSeconds : 0 });
	}
	return out.sort((a, b) => (a.id === GENERAL ? -1 : b.id === GENERAL ? 1 : a.name.localeCompare(b.name)));
}

// ── messages ──

export interface Reaction {
	emoji: string;
	authors: string[]; // Device keys
}

export interface Message {
	id: string;
	author: string;
	name: string;
	ts: number;
	text: string;
	editedAt: number | null;
	deleted: boolean;
	replyTo: string; // Id of the message it answers, or empty
	reactions: Reaction[];
}

// A reaction is a set per (author, emoji): the newest of that author's react and unreact entries decides
export function reactionsFor(reacts: LogEntry[]): Reaction[] {
	const last = new Map<string, LogEntry>();
	for (const r of reacts) {
		const emoji = typeof asRecord(r.body).emoji === "string" ? (asRecord(r.body).emoji as string) : "";
		if (!emoji) continue;
		const key = `${r.author}\u0000${emoji}`;
		const prior = last.get(key);
		if (!prior || r.ts >= prior.ts) last.set(key, r);
	}
	const byEmoji = new Map<string, string[]>();
	for (const r of last.values()) {
		if (r.kind !== "react") continue;
		const emoji = asRecord(r.body).emoji as string;
		byEmoji.set(emoji, [...(byEmoji.get(emoji) ?? []), r.author]);
	}
	return [...byEmoji.entries()].map(([emoji, authors]) => ({ emoji, authors })).sort((a, b) => b.authors.length - a.authors.length || a.emoji.localeCompare(b.emoji));
}

// The messages of one channel, oldest first. A reply never appears before the message it answers, even when the writer's
// clock was behind: it is placed just after its parent.
export function buildMessages(entries: LogEntry[], channel: string): Message[] {
	const inChannel = entries.filter((e) => e.channel === channel);
	const edits = new Map<string, LogEntry>();
	const deleted = new Set<string>();
	const reacts = new Map<string, LogEntry[]>();
	for (const e of inChannel) {
		if (e.kind === "edit") {
			const prior = edits.get(e.parent);
			if (!prior || e.ts >= prior.ts) edits.set(e.parent, e);
		} else if (e.kind === "delete") deleted.add(e.parent);
		else if (e.kind === "react" || e.kind === "unreact") reacts.set(e.parent, [...(reacts.get(e.parent) ?? []), e]);
	}
	const roots = inChannel.filter((e) => e.kind === "message");
	const byId = new Map(roots.map((e) => [e.id, e]));
	const shownAt = new Map<string, number>();
	const at = (e: LogEntry, depth = 0): number => {
		const known = shownAt.get(e.id);
		if (known !== undefined) return known;
		let t = e.ts;
		const parent = byId.get(e.parent);
		if (parent && depth < 50) t = Math.max(t, at(parent, depth + 1) + 1);
		shownAt.set(e.id, t);
		return t;
	};
	return [...roots]
		.sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id))
		.map((e) => {
			const edit = edits.get(e.id);
			return {
				id: e.id,
				author: e.author,
				name: e.name,
				ts: e.ts,
				text: edit ? edit.body : e.body,
				editedAt: edit ? edit.ts : null,
				deleted: deleted.has(e.id),
				replyTo: e.parent,
				reactions: reactionsFor(reacts.get(e.id) ?? []),
			};
		});
}

// Messages by other people that arrived after the channel was last read
export function unreadCount(messages: Message[], lastReadTs: number, me: string): number {
	return messages.filter((m) => !m.deleted && m.author !== me && m.ts > lastReadTs).length;
}

// ── comment threads ──

export interface Anchor {
	from: unknown; // Yjs relative position (JSON) of the start of the commented text
	to: unknown;
	quote: string; // The commented words, to find them again if the characters they sat on were deleted
}

export interface ThreadComment {
	id: string;
	author: string;
	name: string;
	ts: number;
	text: string;
	editedAt: number | null;
	deleted: boolean;
	reactions: Reaction[];
}

export interface Point {
	x: number;
	y: number;
	page?: number; // The page of a PDF, counted from 0; absent for a picture
}

export interface Thread {
	id: string; // The root comment's id
	channel: string;
	anchor: Anchor | null;
	point: Point | null; // For a comment pinned to a place in a picture or on a page of a PDF: 0 to 1 across and down
	field: string; // For a discussion of a conflict: the field it is about; empty otherwise
	resolved: boolean;
	resolvedBy: string; // Name of whoever last resolved it
	resolvedAt: number | null;
	comments: ThreadComment[]; // The root first, then the replies, oldest first
	lastTs: number;
}

function parsePoint(value: unknown): Point | null {
	if (!value || typeof value !== "object") return null;
	const p = value as Record<string, unknown>;
	const ok = (n: unknown): n is number => typeof n === "number" && n >= 0 && n <= 1;
	const page = typeof p.page === "number" && Number.isInteger(p.page) && p.page >= 0 && p.page < 10_000 ? { page: p.page } : {};
	return ok(p.x) && ok(p.y) ? { x: p.x, y: p.y, ...page } : null;
}

function parseAnchor(value: unknown): Anchor | null {
	if (!value || typeof value !== "object") return null;
	const a = value as Record<string, unknown>;
	if (!a.from || !a.to) return null;
	return { from: a.from, to: a.to, quote: typeof a.quote === "string" ? a.quote : "" };
}

// The text of a comment entry: its JSON "text", or the plain body
export function commentText(body: string): string {
	const rec = asRecord(body);
	return typeof rec.text === "string" ? rec.text : body;
}

// Threads of one channel (a file, task or card), newest activity first. A thread with every comment deleted is left out.
export function buildThreads(entries: LogEntry[], channel: string): Thread[] {
	const inChannel = entries.filter((e) => e.channel === channel);
	const edits = new Map<string, LogEntry>();
	const deleted = new Set<string>();
	const state = new Map<string, LogEntry>(); // root id -> its newest resolve or reopen
	const reacts = new Map<string, LogEntry[]>();
	for (const e of inChannel) {
		if (e.kind === "react" || e.kind === "unreact") reacts.set(e.parent, [...(reacts.get(e.parent) ?? []), e]);
		if (e.kind === "edit") {
			const prior = edits.get(e.parent);
			if (!prior || e.ts >= prior.ts) edits.set(e.parent, e);
		} else if (e.kind === "delete") deleted.add(e.parent);
		else if (e.kind === "resolve" || e.kind === "reopen") {
			const prior = state.get(e.parent);
			if (!prior || e.ts >= prior.ts) state.set(e.parent, e);
		}
	}
	const comments = inChannel.filter((e) => e.kind === "comment");
	const roots = comments.filter((e) => !e.parent);
	const out: Thread[] = [];
	for (const root of roots) {
		const mine = [root, ...comments.filter((c) => c.parent === root.id)].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
		const list: ThreadComment[] = mine.map((c) => {
			const edit = edits.get(c.id);
			return { id: c.id, author: c.author, name: c.name, ts: c.ts, text: commentText(edit ? edit.body : c.body), editedAt: edit ? edit.ts : null, deleted: deleted.has(c.id), reactions: reactionsFor(reacts.get(c.id) ?? []) };
		});
		if (list.every((c) => c.deleted)) continue;
		const s = state.get(root.id);
		out.push({
			id: root.id,
			channel,
			anchor: parseAnchor(asRecord(root.body).anchor),
			point: parsePoint(asRecord(root.body).point),
			field: typeof asRecord(root.body).field === "string" ? (asRecord(root.body).field as string) : "",
			resolved: s?.kind === "resolve",
			resolvedBy: s?.kind === "resolve" ? s.name : "",
			resolvedAt: s?.kind === "resolve" ? s.ts : null,
			comments: list,
			lastTs: Math.max(...mine.map((c) => c.ts)),
		});
	}
	return out.sort((a, b) => b.lastTs - a.lastTs);
}

// How many open threads a channel has, for a count beside a file, task or card
export function openThreadCount(entries: LogEntry[], channel: string): number {
	return buildThreads(entries, channel).filter((t) => !t.resolved).length;
}

// Channels that have threads, with how many are open: for the counts in lists
export function openThreadCounts(entries: LogEntry[]): Map<string, number> {
	const channels = new Set(entries.filter((e) => e.kind === "comment" && isThread(e.channel)).map((e) => e.channel));
	const out = new Map<string, number>();
	for (const c of channels) {
		const n = openThreadCount(entries, c);
		if (n > 0) out.set(c, n);
	}
	return out;
}

// ── direct messages ──

export interface Conversation {
	peer: string; // The other device's key
	channel: string; // The id its entries carry, the same from either side
	messages: Message[]; // Opened ones only, oldest first
}

// The recipient a direct message names; its words are sealed and are opened by the backend (`opened`: entry id to text)
const recipientOf = (body: string): string => {
	const to = asRecord(body).to;
	return typeof to === "string" ? to : "";
};

// Direct messages grouped by the other device. An entry that could not be opened (not for this device) is left out.
export function buildConversations(entries: LogEntry[], opened: Record<string, string>, me: string): Map<string, Conversation> {
	const out = new Map<string, Conversation>();
	if (!me) return out;
	for (const e of [...entries].filter((x) => x.kind === "dm").sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))) {
		const text = opened[e.id];
		if (text === undefined) continue;
		const peer = e.author === me ? recipientOf(e.body) : e.author;
		if (!peer) continue;
		const c = out.get(peer) ?? { peer, channel: e.channel, messages: [] };
		c.messages.push({ id: e.id, author: e.author, name: e.name, ts: e.ts, text, editedAt: null, deleted: false, replyTo: "", reactions: [] });
		out.set(peer, c);
	}
	return out;
}

// ── threads of replies ──

// The message at the top of the chain of replies a message belongs to
export function threadRoot(byId: Map<string, Message>, id: string): string {
	let at = id;
	for (let i = 0; i < 100; i++) {
		const parent = byId.get(at)?.replyTo;
		if (!parent || !byId.has(parent)) return at;
		at = parent;
	}
	return at;
}

// For each message that has replies, how many messages answer it directly or through other replies
export function replyCounts(messages: Message[]): Map<string, number> {
	const byId = new Map(messages.map((m) => [m.id, m]));
	const counts = new Map<string, number>();
	for (const m of messages) {
		if (m.deleted) continue;
		let at = m.replyTo;
		for (let i = 0; at && byId.has(at) && i < 100; i++) {
			counts.set(at, (counts.get(at) ?? 0) + 1);
			at = byId.get(at)!.replyTo;
		}
	}
	return counts;
}

// ── arrived late ──

// Messages that reached this device after newer ones: written long before they were held, with a newer message already here.
// `seen` is when this device first held each entry. A batch that arrives together (catching up) is not "late", so a message
// counts only when the newer one was held at least ten seconds before it.
export function lateIds(messages: Message[], seen: Record<string, number>): Set<string> {
	const held = messages.filter((m) => seen[m.id]).sort((a, b) => seen[a.id] - seen[b.id]);
	const late = new Set<string>();
	let newest = 0; // Newest write time among messages held at least ten seconds earlier
	let i = 0;
	for (const m of held) {
		while (i < held.length && seen[held[i].id] <= seen[m.id] - 10_000) {
			newest = Math.max(newest, held[i].ts);
			i++;
		}
		if (newest > m.ts && seen[m.id] - m.ts > 60_000) late.add(m.id);
	}
	return late;
}

// ── export ──

const stamp = (ts: number) => new Date(ts).toISOString().slice(0, 16).replace("T", " ");

// A channel as Markdown, oldest first. `plain` turns stored mentions into names.
export function channelMarkdown(name: string, messages: Message[], plain: (text: string) => string): string {
	const lines = [`# #${name}`, ""];
	for (const m of messages) {
		if (m.deleted) continue;
		const reply = m.replyTo ? " (reply)" : "";
		lines.push(`**${m.name}** · ${stamp(m.ts)}${reply}${m.editedAt ? " · edited" : ""}`, "", plain(m.text), "");
		if (m.reactions.length) lines.push(m.reactions.map((r) => `${r.emoji} ${r.authors.length}`).join("  "), "");
	}
	return lines.join("\n");
}

// Comment threads as a Markdown section to add at the end of an export
export function threadsMarkdown(threads: Thread[], plain: (text: string) => string): string {
	const open = threads.filter((t) => t.comments.some((c) => !c.deleted));
	if (open.length === 0) return "";
	const out = ["", "## Comments", ""];
	for (const th of [...open].sort((a, b) => a.comments[0].ts - b.comments[0].ts)) {
		out.push(`### ${th.resolved ? "Resolved: " : ""}${th.anchor?.quote ? `"${th.anchor.quote.slice(0, 80)}"` : th.field || "Comment"}`, "");
		for (const c of th.comments) if (!c.deleted) out.push(`- **${c.name}** (${stamp(c.ts)}): ${plain(c.text).replace(/\n+/g, " ")}`);
		out.push("");
	}
	return out.join("\n");
}
