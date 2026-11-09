export interface OnlineMember {
	id: string;
	name: string;
	deviceId?: string;
}

export interface OnlinePeer {
	id: string;
	name: string;
}

// A member is online when this device is them, or a connected peer has their device key; the name is only a fallback
// for members stored without a key, since names can repeat but keys cannot.
export function isMemberOnline(member: OnlineMember, peers: OnlinePeer[], isSelf = false): boolean {
	if (isSelf) return true;
	if (member.deviceId) return peers.some((p) => p.id === member.deviceId);
	const name = member.name.trim().toLowerCase();
	return peers.some((p) => p.name.trim().toLowerCase() === name);
}

export function onlineMemberIds(members: OnlineMember[], peers: OnlinePeer[], isSelf: (m: OnlineMember) => boolean): Set<string> {
	return new Set(members.filter((m) => isMemberOnline(m, peers, isSelf(m))).map((m) => m.id));
}
