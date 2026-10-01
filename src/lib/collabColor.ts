// Deterministic cursor colour for a collaborator, derived from their display name, from the Catppuccin accents

import { accentFor, accentSoft, accentVar } from "@/lib/palette";

export function colorForName(name: string): string {
	return accentVar(accentFor(name));
}

// A soft version for selections, since a colour written as a variable cannot have an alpha suffix added to it
export function colorLightForName(name: string): string {
	return accentSoft(accentFor(name), 25);
}
