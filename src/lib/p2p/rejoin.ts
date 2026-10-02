// Where to find the host of a workspace this device joined, kept per local copy of the workspace (keyed by its id).
// It holds the host's address but not the invite secret: the host recognises a device it already has as a member
// by its key, so coming back needs no invite.

export interface Rejoin {
	ticket: string; // The host's address, without the invite secret
	name: string; // The name this device joined under
	hostWorkspaceId: string; // The host's id for the workspace, to be sure the same one answers
}

const rejoinKey = (workspaceId: string) => `nexsync.rejoin:${workspaceId}`;

export function readRejoin(workspaceId: string | undefined): Rejoin | null {
	if (!workspaceId) return null;
	try {
		const value = JSON.parse(localStorage.getItem(rejoinKey(workspaceId)) ?? "null") as Partial<Rejoin> | null;
		return value && typeof value.ticket === "string" && typeof value.name === "string" && typeof value.hostWorkspaceId === "string" ? (value as Rejoin) : null;
	} catch {
		return null;
	}
}

export function saveRejoin(workspaceId: string, rejoin: Rejoin | null) {
	try {
		if (rejoin === null) localStorage.removeItem(rejoinKey(workspaceId));
		else localStorage.setItem(rejoinKey(workspaceId), JSON.stringify(rejoin));
	} catch {
		// Only affects whether this device can come back by itself
	}
}
