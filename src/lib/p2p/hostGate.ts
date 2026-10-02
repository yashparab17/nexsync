// A workspace can require its host to be online: guests may then only work while connected to the host

export type HostGate = "ok" | "connecting" | "offline";

export interface HostGateInput {
	joined: boolean; // This copy was joined from somebody else's workspace
	required: boolean; // The workspace's setting
	hasHost: boolean; // The host is connected right now
	trying: boolean; // A connection to the host is being made or re-made
	failed: boolean; // The last attempt did not get through
	canRetry: boolean; // This copy knows how to find the host again
}

// How this device is connected to the workspace: through its host, through other members while the host is away, or not at all
export type Link = "host" | "members" | "none";

export function linkOf(peers: { isHost: boolean }[]): Link {
	return peers.some((p) => p.isHost) ? "host" : peers.length > 0 ? "members" : "none";
}

// "ok": work as normal. "connecting": hold the screen while the host is being reached. "offline": the host is not there
export function hostGateOf(s: HostGateInput): HostGate {
	if (!s.joined || !s.required || s.hasHost) return "ok";
	if (s.trying) return "connecting";
	// Nothing to wait for when there is no saved way back to the host, or the way back just failed
	return s.failed || !s.canRetry ? "offline" : "connecting";
}
