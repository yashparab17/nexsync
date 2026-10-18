// The files opened most recently in the Editor, per workspace, kept on this device

import { useEffect, useState } from "react";

const MAX = 12;
// Sent on the window whenever a list changes, for everything showing it
const CHANGED = "nexsync:recent";
const keyFor = (workspacePath: string) => `nexsync.recent.${workspacePath}`;

export function readRecent(workspacePath: string): string[] {
	try {
		const list = JSON.parse(localStorage.getItem(keyFor(workspacePath)) ?? "[]");
		return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string").slice(0, MAX) : [];
	} catch {
		return [];
	}
}

export function pushRecent(workspacePath: string, path: string): string[] {
	return write(workspacePath, [path, ...readRecent(workspacePath).filter((p) => p !== path)].slice(0, MAX));
}

function write(workspacePath: string, next: string[]): string[] {
	try {
		localStorage.setItem(keyFor(workspacePath), JSON.stringify(next));
	} catch {
		// Not remembered this time
	}
	window.dispatchEvent(new CustomEvent(CHANGED, { detail: workspacePath }));
	return next;
}

// Keeps only the files `keep` allows, so a deleted or renamed file leaves the list
export function filterRecent(workspacePath: string, keep: (path: string) => boolean): string[] {
	const current = readRecent(workspacePath);
	const next = current.filter(keep);
	return next.length === current.length ? current : write(workspacePath, next);
}

const trim = (rel: string) => rel.replace(/^\/+|\/+$/g, "");
const inside = (path: string, rel: string) => path === rel || path.startsWith(`${rel}/`);

// A file or folder was deleted: it, and everything in it, leaves the list
export function forgetRecent(workspacePath: string, rel: string): string[] {
	const gone = trim(rel);
	return filterRecent(workspacePath, (p) => !inside(p, gone));
}

// A file or folder was renamed: the list follows it
export function renameRecent(workspacePath: string, rel: string, newName: string): string[] {
	const from = trim(rel);
	const to = [...from.split("/").slice(0, -1), newName].join("/");
	const current = readRecent(workspacePath);
	if (!current.some((p) => inside(p, from))) return current;
	return write(workspacePath, current.map((p) => (inside(p, from) ? to + p.slice(from.length) : p)));
}

// The list for a workspace, kept current as files are opened, deleted and renamed (here or in another window)
export function useRecent(workspacePath: string | undefined): string[] {
	const [list, setList] = useState<string[]>(() => (workspacePath ? readRecent(workspacePath) : []));
	useEffect(() => {
		const read = () => setList(workspacePath ? readRecent(workspacePath) : []);
		read();
		window.addEventListener(CHANGED, read);
		window.addEventListener("storage", read);
		return () => {
			window.removeEventListener(CHANGED, read);
			window.removeEventListener("storage", read);
		};
	}, [workspacePath]);
	return list;
}
