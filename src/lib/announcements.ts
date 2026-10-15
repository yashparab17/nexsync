// Announcements, as a person sees them, worked out from the signed log (see src-tauri/src/commands/workspace/announce.rs).
//
// An announcement is an entry of kind "announce". A newer entry that names it as its parent is a new version of it, an
// "announce_end" withdraws it, each "ack" is one member's "Got it", and an "expire" entry (for any item) says when it is to be
// erased. This file is a pure function of the entries, so two devices holding the same entries show the same thing; the one
// input it takes besides them is the time, which each device reads from its own corrected clock.

import { reactionsFor, type LogEntry, type Reaction } from "./chat/entries";

export const CHANNEL = "announcements";
export const LEVELS = ["info", "important", "urgent"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_NAMES: Record<Level, string> = { info: "Info", important: "Important", urgent: "Urgent" };
export const MAX_PINNED = 3;

export interface Audience {
	roles: string[]; // "Admin", "Editor", "Commenter", "Viewer"; empty with no members means everyone
	members: string[]; // Device keys
}

export interface AnnouncementDraft {
	title: string;
	text: string;
	level: Level;
	ends: number; // 0 for never
	notBefore: number; // 0 for at once
	pinned: boolean;
	system: boolean;
	audience: Audience;
}

export interface Announcement extends AnnouncementDraft {
	id: string;
	author: string; // Device key of whoever first posted it
	name: string;
	ts: number; // When it was first posted
	updatedAt: number; // When the newest version was written
	edited: boolean;
	withdrawn: boolean;
	withdrawnBy: string;
	acks: { key: string; name: string; ts: number }[];
	reactions: Reaction[];
	expiresAt: number; // When it will be erased for good; 0 for never
}

export type Status = "scheduled" | "active" | "ended" | "withdrawn";

const asRecord = (text: string): Record<string, unknown> => {
	try {
		const v = JSON.parse(text);
		return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function draftOf(body: string): AnnouncementDraft | null {
	const r = asRecord(body);
	if (typeof r.title !== "string" || !r.title.trim()) return null;
	const level = (LEVELS as readonly string[]).includes(r.level as string) ? (r.level as Level) : "info";
	const a = (r.audience && typeof r.audience === "object" ? r.audience : {}) as Record<string, unknown>;
	return {
		title: r.title,
		text: typeof r.text === "string" ? r.text : "",
		level,
		ends: num(r.ends),
		notBefore: num(r.notBefore),
		pinned: r.pinned === true,
		system: r.system === true,
		audience: { roles: strings(a.roles), members: strings(a.members) },
	};
}

// The newest expiry entry of an item decides; one that says 0 cancels it
export function expiryOf(entries: LogEntry[], entity: string, id: string): number {
	let newest: LogEntry | null = null;
	for (const e of entries) {
		if (e.kind !== "expire") continue;
		const r = asRecord(e.body);
		if (r.entity !== entity || r.id !== id) continue;
		if (!newest || e.ts >= newest.ts) newest = e;
	}
	return newest ? num(asRecord(newest.body).at) : 0;
}

// All announcements, newest first. Those whose expiry has passed are left out: the backend erases them, and until it has, they
// are not shown.
export function buildAnnouncements(entries: LogEntry[], now: number): Announcement[] {
	const roots = entries.filter((e) => e.kind === "announce" && !e.parent);
	const versions = new Map<string, LogEntry>();
	const withdrawn = new Map<string, LogEntry>();
	const acks = new Map<string, Map<string, LogEntry>>();
	const reacts = new Map<string, LogEntry[]>();
	for (const e of entries) {
		if (e.channel !== CHANNEL) continue;
		if (e.kind === "announce" && e.parent) {
			const prior = versions.get(e.parent);
			if (!prior || e.ts >= prior.ts) versions.set(e.parent, e);
		} else if (e.kind === "announce_end") {
			const prior = withdrawn.get(e.parent);
			if (!prior || e.ts >= prior.ts) withdrawn.set(e.parent, e);
		} else if (e.kind === "ack") {
			const mine = acks.get(e.parent) ?? new Map<string, LogEntry>();
			const prior = mine.get(e.author);
			if (!prior || e.ts < prior.ts) mine.set(e.author, e);
			acks.set(e.parent, mine);
		} else if (e.kind === "react" || e.kind === "unreact") reacts.set(e.parent, [...(reacts.get(e.parent) ?? []), e]);
	}
	const out: Announcement[] = [];
	for (const root of roots) {
		const version = versions.get(root.id);
		const draft = draftOf((version ?? root).body) ?? draftOf(root.body);
		if (!draft) continue;
		const expiresAt = expiryOf(entries, "announcement", root.id);
		if (expiresAt && expiresAt <= now) continue;
		const end = withdrawn.get(root.id);
		out.push({
			...draft,
			id: root.id,
			author: root.author,
			name: root.name,
			ts: root.ts,
			updatedAt: (version ?? root).ts,
			edited: !!version,
			withdrawn: !!end,
			withdrawnBy: end?.name ?? "",
			acks: [...(acks.get(root.id)?.values() ?? [])].map((a) => ({ key: a.author, name: a.name, ts: a.ts })).sort((a, b) => a.ts - b.ts),
			reactions: reactionsFor(reacts.get(root.id) ?? []),
			expiresAt,
		});
	}
	return out.sort((a, b) => b.ts - a.ts);
}

export function statusOf(a: Announcement, now: number): Status {
	if (a.withdrawn) return "withdrawn";
	if (a.notBefore > now) return "scheduled";
	if (a.ends > 0 && a.ends <= now) return "ended";
	return "active";
}

// Whether the announcement is addressed to this person, by its audience alone
export function inAudience(a: Announcement, me: string, role: string): boolean {
	const { roles, members } = a.audience;
	if (roles.length === 0 && members.length === 0) return true;
	return members.includes(me) || roles.includes(role);
}

// Posters and moderators see everything they posted or may moderate; everyone else only what is for them
export function forMe(a: Announcement, me: string, role: string): boolean {
	return a.author === me || role === "Owner" || role === "Admin" || inAudience(a, me, role);
}

export const acknowledged = (a: Announcement, me: string): boolean => a.acks.some((k) => k.key === me);

// Active, for this person, asks to be acknowledged, and not yet acknowledged: what stays as a banner or opens a dialog
export function waitingForMe(list: Announcement[], me: string, role: string, now: number): Announcement[] {
	return list.filter((a) => statusOf(a, now) === "active" && a.level !== "info" && forMe(a, me, role) && a.author !== me && !acknowledged(a, me));
}

// An Info notice the app writes by itself (an ownership change, a removal the Owner chose to announce)
export const systemNotice = (title: string, text = ""): AnnouncementDraft => ({ title, text, level: "info", ends: 0, notBefore: 0, pinned: false, system: true, audience: { roles: [], members: [] } });

// Up to three pinned announcements, the newest first, then the rest
export function ordered(list: Announcement[], now: number): Announcement[] {
	const live = list.filter((a) => statusOf(a, now) === "active");
	const pinned = live.filter((a) => a.pinned).slice(0, MAX_PINNED);
	return [...pinned, ...live.filter((a) => !pinned.includes(a))];
}

// Who the announcement is for, in words
export function audienceText(a: Announcement, names: (key: string) => string): string {
	const { roles, members } = a.audience;
	if (roles.length === 0 && members.length === 0) return "Everyone";
	return [...roles.map((r) => `${r}s`), ...members.map(names)].join(", ");
}

// "2 days", "5 hours": how long until a moment, for the countdown badge
export function timeUntil(at: number, now: number): string {
	const ms = Math.max(0, at - now);
	const minutes = Math.ceil(ms / 60_000);
	if (minutes < 60) return `${Math.max(1, minutes)} min`;
	const hours = Math.ceil(minutes / 60);
	if (hours < 48) return `${hours} h`;
	return `${Math.ceil(hours / 24)} days`;
}
