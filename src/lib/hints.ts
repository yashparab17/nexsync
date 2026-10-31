// Whether the first-visit hints on the Welcome page have been dealt with; when storage is blocked they count as seen, so they never nag
const SEEN_KEY = "nexsync.tourSeen";

export function hintsSeen(): boolean {
	try {
		return localStorage.getItem(SEEN_KEY) === "1";
	} catch {
		return true;
	}
}

export function markHintsSeen() {
	try {
		localStorage.setItem(SEEN_KEY, "1");
	} catch {
		// Only means the hint may show again next time
	}
}
