// The notes a person has pinned to the top of the list, per workspace, kept on this device

const keyFor = (workspacePath: string) => `nexsync.pinned-notes.${workspacePath}`;

export function readPins(workspacePath: string): string[] {
	try {
		const list = JSON.parse(localStorage.getItem(keyFor(workspacePath)) ?? "[]");
		return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
	} catch {
		return [];
	}
}

export function writePins(workspacePath: string, pins: string[]) {
	try {
		localStorage.setItem(keyFor(workspacePath), JSON.stringify(pins));
	} catch {
		// Not remembered this time
	}
}
