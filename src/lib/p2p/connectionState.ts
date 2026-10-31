// What the connection button in the window bar says. Most of the time it says nothing: a dot of the right colour is enough, and a word
// appears only when something needs the person's attention.

export interface ConnectionInput {
	online: boolean;
	status: "offline" | "connecting" | "reconnecting" | "connected";
	connected: number;
	// "host": the host is among those connected; "members": only other members are; "none": nobody is
	link: "host" | "members" | "none";
	// The name of the host of a workspace this copy was joined from, null in a workspace of our own
	hostName: string | null;
	hostUnreachable: boolean;
	syncing: boolean;
}

export type Tone = "ok" | "idle" | "busy" | "warn" | "bad";

export interface ConnectionView {
	key: "offline" | "connecting" | "syncing" | "host-away-members" | "host-away-alone" | "connected" | "idle";
	tone: Tone;
	// Shown beside the dot; empty when the dot says it all
	label: string;
	// The sentence for the tooltip and for screen readers
	title: string;
}

export function connectionView(i: ConnectionInput): ConnectionView {
	const host = i.hostName ?? "The host";
	if (!i.online) return { key: "offline", tone: "bad", label: "Offline", title: "No internet. Your changes are kept here and shared when you are back online." };
	if (i.syncing) return { key: "syncing", tone: "busy", label: "Syncing", title: "Getting changes from the people you are connected to." };
	// A joined copy whose host is not there, but with other members: work carries on, and the host catches up later
	if (i.hostName !== null && i.connected > 0 && i.link === "members") {
		return { key: "host-away-members", tone: "warn", label: "Host away", title: `${host} is offline. You are working with ${i.connected === 1 ? "another member" : `${i.connected} other members`}, and ${host} gets your changes when they are back. Settings, roles and invites need the host.` };
	}
	if (i.hostName !== null && i.connected === 0 && (i.hostUnreachable || i.status === "offline")) {
		return { key: "host-away-alone", tone: "warn", label: "Host away", title: `${host} is offline. Your copy keeps working, and it tries again by itself. Your changes are shared when ${host} is back.` };
	}
	if (i.status === "connecting" || i.status === "reconnecting") return { key: "connecting", tone: "busy", label: i.status === "reconnecting" ? "Reconnecting" : "Connecting", title: "Connecting to the other devices." };
	if (i.connected > 0) return { key: "connected", tone: "ok", label: "", title: `${i.connected} ${i.connected === 1 ? "person" : "people"} connected.` };
	return { key: "idle", tone: "idle", label: "", title: "Not shared right now. Open Collaborate to invite someone." };
}

export const TONE_DOT: Record<Tone, string> = {
	ok: "bg-success",
	idle: "bg-muted-foreground/50",
	busy: "bg-info animate-pulse motion-reduce:animate-none",
	warn: "bg-warning",
	bad: "bg-destructive",
};
