// The name this device joined a workspace under, kept per local copy of the workspace (keyed by its id, since paths vary in spelling)

const selfNameKey = (workspaceId: string) => `nexsync.selfName:${workspaceId}`;

export function readSelfName(workspaceId: string | undefined): string | null {
	if (!workspaceId) return null;
	try {
		return localStorage.getItem(selfNameKey(workspaceId));
	} catch {
		return null;
	}
}

export function setSelfName(workspaceId: string, name: string | null) {
	try {
		if (name === null) localStorage.removeItem(selfNameKey(workspaceId));
		else localStorage.setItem(selfNameKey(workspaceId), name);
	} catch {
		// Only affects whether this copy shows the host's controls
	}
}

// Name used on what this device writes: the joined name, otherwise the owner of this workspace
export function myName(workspaceId: string | undefined, ownerName: string | undefined): string {
	return readSelfName(workspaceId) ?? ownerName ?? "You";
}
