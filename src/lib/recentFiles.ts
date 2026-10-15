// The files opened most recently in the Editor, per workspace, kept on this device

const MAX = 12;
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
	const next = [path, ...readRecent(workspacePath).filter((p) => p !== path)].slice(0, MAX);
	try {
		localStorage.setItem(keyFor(workspacePath), JSON.stringify(next));
	} catch {
		// Not remembered this time
	}
	return next;
}

// Keeps only the files `keep` allows, so a deleted or renamed file leaves the list
export function filterRecent(workspacePath: string, keep: (path: string) => boolean): string[] {
	const current = readRecent(workspacePath);
	const next = current.filter(keep);
	if (next.length === current.length) return current;
	try {
		localStorage.setItem(keyFor(workspacePath), JSON.stringify(next));
	} catch {
		// Not remembered this time
	}
	return next;
}
