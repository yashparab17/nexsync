// The name a person goes by in one workspace. Unlike the name they joined under, it is unique there and they can change it

import type { Member } from "@/types/workspace";

export const MAX_NAME = 64;

// What may be saved as a name: no control characters, trimmed, and a limited length
export const cleanName = (raw: string) => [...raw].filter((c) => c >= " " && c !== "\u007f").join("").trim().slice(0, MAX_NAME);

// Why a name cannot be used, or null when it can; `exceptId` is the member who is changing their own name
export function nameProblem(members: Member[], raw: string, exceptId?: string): string | null {
	const name = cleanName(raw);
	if (!name) return "Enter a name.";
	if (members.some((m) => m.id !== exceptId && m.name.toLowerCase() === name.toLowerCase())) return `Someone in this workspace is already called ${name}.`;
	return null;
}

// The first free name starting from the one asked for: Sam, Sam (2), Sam (3)
export function freeName(members: Member[], raw: string): string {
	const base = cleanName(raw) || "Collaborator";
	let name = base;
	for (let n = 2; nameProblem(members, name) !== null; n++) name = `${base} (${n})`;
	return name;
}
