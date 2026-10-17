// How a person looks to the others: a colour and a small picture. They are set once, in Settings, kept on this device, and shared
// into each workspace as a signed entry of the log (kind "profile"), so every member's device shows the same colour and picture
// wherever the person's avatar or cursor appears. The newest entry of each author wins; names are unique in a workspace, so the
// entry's name is what the avatars look up.

import { useSyncExternalStore } from "react";

import type { LogEntry } from "@/features/chat/lib/entries";
import { PALETTE, randomColor, setChosenColors } from "@/lib/collabColor";

export interface Profile {
	color?: string;
	image?: string; // A data address of a small picture
}

const KEY = "nexsync-profile";
const COLOR = /^#[0-9a-fA-F]{6}$/;
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE = 18_000;

export function parseProfile(text: string | null): Profile | null {
	if (!text) return null;
	try {
		const v = JSON.parse(text) as Record<string, unknown>;
		if (!v || typeof v !== "object") return null;
		const out: Profile = {};
		if (typeof v.color === "string" && COLOR.test(v.color) && PALETTE.includes(v.color.toLowerCase())) out.color = v.color.toLowerCase();
		if (typeof v.image === "string" && IMAGE.test(v.image) && v.image.length <= MAX_IMAGE) out.image = v.image;
		return out;
	} catch {
		return null;
	}
}

// This person's own choice, on this device
export function getLocalProfile(): Profile {
	try {
		return parseProfile(localStorage.getItem(KEY)) ?? {};
	} catch {
		return {};
	}
}

// A person who has not chosen a colour is given one at random, once, and it is kept like a choice
export function ensureLocalColor(): Profile {
	const p = getLocalProfile();
	if (p.color) return p;
	const next = { ...p, color: randomColor() };
	setLocalProfile(next);
	return next;
}

export function setLocalProfile(profile: Profile): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(profile));
		window.dispatchEvent(new Event("nexsync-profile"));
	} catch {
		/* blocked storage: the choice is not kept */
	}
}

// ── what the workspace's members chose ──

const others = new Map<string, Profile>();
const listeners = new Set<() => void>();
const keyOf = (name: string) => name.trim().toLowerCase();

// The newest profile entry of each author, by the name it was written under
export function profilesFromEntries(entries: LogEntry[]): Map<string, Profile> {
	const newest = new Map<string, LogEntry>();
	for (const e of entries) {
		if (e.kind !== "profile") continue;
		const prior = newest.get(e.author);
		if (!prior || e.ts >= prior.ts) newest.set(e.author, e);
	}
	const out = new Map<string, Profile>();
	for (const e of newest.values()) {
		const p = parseProfile(e.body);
		if (p && (p.color || p.image)) out.set(keyOf(e.name), p);
	}
	return out;
}

export function setProfiles(map: Map<string, Profile>): void {
	others.clear();
	for (const [k, v] of map) others.set(k, v);
	setChosenColors(new Map([...map].filter(([, p]) => p.color).map(([k, p]) => [k, p.color!])));
	for (const l of listeners) l();
}

export function useProfile(name: string): Profile | undefined {
	return useSyncExternalStore(
		(cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		() => others.get(keyOf(name)),
	);
}
