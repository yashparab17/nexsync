// One line in plain words for why a field is in conflict, from the writes that are stored with it. Two values are in conflict
// because neither write was made knowing about the other. The stamps that show this can be wrong when people rarely sync
// (RESEARCH.md §8i), so the line says "probably".

import type { ConflictOption } from "@/types/workspace";

const clock = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export function whyConflict(options: ConflictOption[], show: (value: unknown) => string): string {
	if (options.length < 2) return "";
	const byTime = [...options].sort((a, b) => a.ts - b.ts);
	const part = (o: ConflictOption) => `${o.who || "Someone"} set “${show(o.value) || "(empty)"}” at ${clock(o.ts)}`;
	const shown = byTime.slice(0, 2).map(part).join(", and ");
	const more = byTime.length > 2 ? ` (and ${byTime.length - 2} more)` : "";
	return `${shown}${more}. Neither probably saw the other's change first, so both were kept for you to choose.`;
}
