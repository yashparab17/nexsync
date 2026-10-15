// Replaying how a task or card got its values: every write this device has held for it, in the order they were stamped.
// The log is kept by the backend (write_log). A write that reached this device long after its stamp was made while the
// writer was apart; the stamps cannot say for sure whether the other writer had seen it (RESEARCH.md §8i), so the replay only
// says "reached this device later".

export interface LoggedWrite {
	path: string;
	ts: number;
	who: string;
	by: string;
	replica: string;
	value: string; // JSON text
	seenAt: number;
}

// The moments worth stopping at: each distinct write time, oldest first
export function stops(log: LoggedWrite[]): number[] {
	return [...new Set(log.map((w) => w.ts))].sort((a, b) => a - b);
}

// The value each field showed at a moment: its newest write stamped no later than then (the later of two equal stamps wins,
// as in the log's own order)
export function valuesAt(log: LoggedWrite[], t: number): Map<string, LoggedWrite> {
	const out = new Map<string, LoggedWrite>();
	for (const w of log) if (w.ts <= t && (out.get(w.path)?.ts ?? -1) <= w.ts) out.set(w.path, w);
	return out;
}

// Whoever wrote it: the name it was written under, or the start of the device key
export const laneOf = (w: LoggedWrite): string => w.who || (w.by ? w.by.slice(0, 8) : w.replica.slice(0, 8)) || "unknown";

// Whether a write reached this device long after it was stamped, which is what writing while apart looks like
export const arrivedLate = (w: LoggedWrite, graceMs = 60_000): boolean => w.seenAt > 0 && w.seenAt - w.ts > graceMs;

export function parseValue(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}
