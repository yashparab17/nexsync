// How a person arranged the sidebar of one workspace: pages pinned to the top, and the order of the pages inside each group.
// Kept on this device, per workspace.

export interface SidebarPrefs {
	pinned: string[]; // page paths, in the order shown
	order: Record<string, string[]>; // group id -> page paths
}

export const EMPTY_PREFS: SidebarPrefs = { pinned: [], order: {} };

const key = (workspaceId: string) => `nexsync.sidebar.prefs:${workspaceId}`;
const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : []);

export function parsePrefs(raw: unknown): SidebarPrefs {
	const r = (raw && typeof raw === "object" ? raw : {}) as Partial<SidebarPrefs>;
	const order: Record<string, string[]> = {};
	if (r.order && typeof r.order === "object") for (const [id, list] of Object.entries(r.order)) order[id] = strings(list);
	return { pinned: strings(r.pinned), order };
}

export function loadPrefs(workspaceId: string): SidebarPrefs {
	try {
		return parsePrefs(JSON.parse(localStorage.getItem(key(workspaceId)) ?? "null"));
	} catch {
		return EMPTY_PREFS;
	}
}

export function savePrefs(workspaceId: string, prefs: SidebarPrefs) {
	try {
		localStorage.setItem(key(workspaceId), JSON.stringify(prefs));
	} catch {
		// Not remembered this time
	}
}

export function togglePin(prefs: SidebarPrefs, path: string): SidebarPrefs {
	return { ...prefs, pinned: prefs.pinned.includes(path) ? prefs.pinned.filter((p) => p !== path) : [...prefs.pinned, path] };
}

// The items in the saved order; items the order does not know (new pages) keep their place after the known ones
export function applyOrder<T extends { path: string }>(items: T[], order: string[] | undefined): T[] {
	if (!order?.length) return items;
	const rank = (p: string) => (order.includes(p) ? order.indexOf(p) : order.length);
	return [...items].sort((a, b) => rank(a.path) - rank(b.path));
}

// `path` takes the place of `target` among the paths of a group (or of the pinned list)
export function moveBefore(paths: string[], path: string, target: string): string[] {
	if (path === target || !paths.includes(path) || !paths.includes(target)) return paths;
	const rest = paths.filter((p) => p !== path);
	rest.splice(rest.indexOf(target), 0, path);
	return rest;
}

export function shift(paths: string[], path: string, by: -1 | 1): string[] {
	const i = paths.indexOf(path);
	const j = i + by;
	if (i < 0 || j < 0 || j >= paths.length) return paths;
	const next = [...paths];
	[next[i], next[j]] = [next[j], next[i]];
	return next;
}
