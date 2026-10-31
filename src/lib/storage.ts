// What this device remembers. Storage can be blocked or full (a private window, cleared site data), so every read and write is
// guarded here once, and the app works the same without it: a setting just lasts until the app closes.

export function readStored(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

// `null` forgets the key
export function saveStored(key: string, value: string | null): void {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// Not remembered this time
	}
}

// A switch. `whenBlocked` is the answer if storage cannot be read at all.
export function readFlag(key: string, whenBlocked = false): boolean {
	try {
		return localStorage.getItem(key) === "1";
	} catch {
		return whenBlocked;
	}
}

export const saveFlag = (key: string, on: boolean) => saveStored(key, on ? "1" : "0");

export function readJson<T>(key: string, fallback: T): T {
	const raw = readStored(key);
	if (raw === null) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export const saveJson = (key: string, value: unknown) => saveStored(key, JSON.stringify(value));
