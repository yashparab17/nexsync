import type { Member } from "@/types/workspace";

// Roles a member can be set to. Owner belongs to whoever created the workspace and is never handed out.
export const ASSIGNABLE_ROLES = ["Admin", "Editor", "Viewer"] as const;

// Whether `actor` may change a member currently holding `target` to `next`.
// The Owner manages everyone; an Admin manages Editors and Viewers but cannot create or touch other Admins.
export function canChangeRole(actor: string, target: string, next: string): boolean {
	if (!(ASSIGNABLE_ROLES as readonly string[]).includes(next)) return false;
	if (actor === "Owner") return target !== "Owner";
	if (actor === "Admin") return (target === "Editor" || target === "Viewer") && next !== "Admin";
	return false;
}

// Device key to role, which the host enforces on the wire; members without a known device are left out
export function roleTable(members: Member[]): [string, string][] {
	return members.flatMap((m): [string, string][] => (m.deviceId && m.role !== "Owner" ? [[m.deviceId, m.role]] : []));
}

// Adds or updates the member for a guest that just connected, keyed by the device key rather than the display name
export function bindGuestMember(
	members: Member[],
	peer: { id: string; name: string; role: string },
	newId: () => string = () => crypto.randomUUID(),
): Member[] {
	if (members.some((m) => m.deviceId === peer.id)) return members;

	// Members made before device keys existed are claimed by the first guest with their name
	const legacy = members.find((m) => !m.deviceId && m.role !== "Owner" && m.name.toLowerCase() === peer.name.toLowerCase());
	if (legacy) return members.map((m) => (m === legacy ? { ...m, deviceId: peer.id, role: peer.role } : m));

	// A new device never takes over an existing member's name, the Owner's included
	const taken = new Set(members.map((m) => m.name.toLowerCase()));
	let name = peer.name;
	for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${peer.name} (${n})`;
	return [...members, { id: newId(), name, role: peer.role, deviceId: peer.id }];
}
