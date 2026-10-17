// Whether a side panel is folded away, kept on this device by the panel's name. Every panel that can be folded uses this, so the choice
// survives a restart and two views of the same panel agree.

import { useCallback, useSyncExternalStore } from "react";

const PREFIX = "nexsync.fold.";
const listeners = new Set<() => void>();
const memory = new Map<string, boolean>();

function read(id: string): boolean {
	if (memory.has(id)) return memory.get(id)!;
	let v = false;
	try {
		v = localStorage.getItem(PREFIX + id) === "1";
	} catch {
		// Not remembered
	}
	memory.set(id, v);
	return v;
}

export function setCollapsed(id: string, value: boolean) {
	memory.set(id, value);
	try {
		if (value) localStorage.setItem(PREFIX + id, "1");
		else localStorage.removeItem(PREFIX + id);
	} catch {
		// Not remembered
	}
	for (const l of listeners) l();
}

export function useCollapsed(id: string): [boolean, () => void] {
	const value = useSyncExternalStore(
		(cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		() => read(id),
	);
	const toggle = useCallback(() => setCollapsed(id, !read(id)), [id]);
	return [value, toggle];
}
