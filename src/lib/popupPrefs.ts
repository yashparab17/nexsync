// Whether the brief pop-ups (collaborator joined, task assigned...) are shown on this device. Muted, the same notices still land in the
// notification list; only the pop-up is skipped.

const KEY = "nexsync.popups.muted";

export function readPopupsMuted(): boolean {
	try {
		return localStorage.getItem(KEY) === "1";
	} catch {
		return false;
	}
}

export function savePopupsMuted(muted: boolean): void {
	try {
		if (muted) localStorage.setItem(KEY, "1");
		else localStorage.removeItem(KEY);
	} catch {
		// Not remembered this time
	}
}
