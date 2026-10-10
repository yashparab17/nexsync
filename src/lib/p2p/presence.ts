// Who is where in a workspace: the message each device sends, and the words and links built from it

import type { ProbeResult } from "@/lib/p2p/transport";

// Pages a person can be on; anything else a peer sends is ignored, since following sends this device there
const PAGES = ["dashboard", "notes", "editor", "files", "assets", "tasks", "kanban", "insights", "members", "trash", "settings"] as const;

export interface Presence {
	page: string; // One of PAGES
	item: string | null; // The file path, card id or task id open on that page
	away: boolean; // No input for a while
}

export interface PeerPresence extends Presence {
	at: number; // When it arrived here
}

// A device with no input for this long shows as away
export const IDLE_MS = 5 * 60 * 1000;
// Sent again now and then, so someone who joined later still learns where everyone is
export const HEARTBEAT_MS = 45 * 1000;

export const HERE: Presence = { page: "dashboard", item: null, away: false };

export function parsePresence(payload: string | undefined): Presence | null {
	try {
		const p = JSON.parse(payload ?? "") as Partial<Presence> | null;
		if (!p || typeof p.page !== "string" || !(PAGES as readonly string[]).includes(p.page)) return null;
		if (p.item != null && (typeof p.item !== "string" || p.item.length > 300)) return null;
		return { page: p.page, item: p.item ?? null, away: p.away === true };
	} catch {
		return null;
	}
}

// "/workspace/notes" is the notes page, "/workspace" the dashboard; null outside a workspace page
export function pageOf(pathname: string): string | null {
	const m = /^\/workspace(?:\/([^/]+))?/.exec(pathname);
	if (!m) return null;
	const page = m[1] ?? "dashboard";
	return (PAGES as readonly string[]).includes(page) ? page : null;
}

const name = (page: string) => page.charAt(0).toUpperCase() + page.slice(1);

// "Notes · plan.md", or "Away" when idle
export function placeLabel(p: Presence): string {
	const where = p.item ? `${name(p.page)} · ${p.item.split("/").pop()}` : name(p.page);
	return p.away ? `Away, last on ${where}` : where;
}

// The route that shows what someone is looking at; every page opens `?open=` items itself
export function followPath(p: Presence): string {
	const base = p.page === "dashboard" ? "/workspace" : `/workspace/${p.page}`;
	return p.item ? `${base}?open=${encodeURIComponent(p.item)}` : base;
}

// Who is on a page, or has one item open; an away person still counts as being there
export function whoIsAt(all: Record<string, PeerPresence>, page: string, item?: string): string[] {
	return Object.entries(all)
		.filter(([, p]) => p.page === page && (item === undefined || p.item === item))
		.map(([who]) => who);
}

// One line for what dialing a member by key found
export function probeText(r: ProbeResult): string {
	const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
	if (!r.reachable) return `Not reachable from here: ${r.error ?? "no answer"}`;
	const how = r.path === "direct" ? `directly, ${r.rttMs} ms` : "through a relay";
	return `Reachable ${how}, connected in ${secs(r.connectMs)}`;
}

// "2 hours ago", for someone who has left
export function lastSeenText(at: number, now = Date.now()): string {
	const mins = Math.floor((now - at) / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
	const days = Math.floor(hours / 24);
	return `${days} ${days === 1 ? "day" : "days"} ago`;
}

// "7 minutes ahead", for a device whose clock differs from this one's (positive: its clock is ahead)
export function skewText(ms: number): string {
	const mins = Math.round(Math.abs(ms) / 60000);
	const amount =
		mins >= 1440 ? `${Math.round(mins / 1440)} ${Math.round(mins / 1440) === 1 ? "day" : "days"}` : mins >= 120 ? `${Math.round(mins / 60)} hours` : `${mins} ${mins === 1 ? "minute" : "minutes"}`;
	return `${amount} ${ms > 0 ? "ahead" : "behind"}`;
}

// A setting for this device: join and leave toasts off
const QUIET_KEY = "nexsync.quietPresence";

export function readQuiet(): boolean {
	try {
		return localStorage.getItem(QUIET_KEY) === "1";
	} catch {
		return false;
	}
}

export function saveQuiet(on: boolean) {
	try {
		localStorage.setItem(QUIET_KEY, on ? "1" : "0");
	} catch {
		// The setting then lasts until the app closes, which is acceptable
	}
}
