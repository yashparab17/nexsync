// What this device remembers about a workspace folder (recent files, pinned notes, panel choices) is kept under the folder's path. A new
// workspace made in the same place, or one that was deleted, must not inherit it, so it is cleared when a workspace is made or deleted.

const norm = (p: string) => p.split("\\").join("/").replace(/\/+$/, "").toLowerCase();

export function forgetWorkspace(path: string): void {
	try {
		const want = norm(path);
		const keys: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && k.startsWith("nexsync.") && norm(k).endsWith(`.${want}`)) keys.push(k);
		}
		keys.forEach((k) => localStorage.removeItem(k));
	} catch {
		// Storage is blocked: nothing was remembered
	}
}
