// What the activity feed does about noise: writing in a note saves it again and again, and each save was a line in everyone's feed. A save by
// the same person of the same item, soon after the last one, is no new line.

import type { ActivityEvent } from "@/types/workspace";

// How soon after the last save of an item another save is not worth a line
export const REPEAT_MS = 10 * 60 * 1000;

// Saves, which are the lines that repeat while someone is writing
export const isEdit = (e: Pick<ActivityEvent, "action">) => /^(saved|edited|updated)\b/i.test(e.action);

// Whether `next` repeats the newest line: the same action on the same item by the same person within the window
export function isRepeat(events: ActivityEvent[], next: Pick<ActivityEvent, "action" | "target" | "author" | "timestamp">, windowMs = REPEAT_MS): boolean {
	const last = events[0];
	if (!last || !isEdit(next)) return false;
	return last.action === next.action && (last.target ?? "") === (next.target ?? "") && (last.author ?? "") === (next.author ?? "") && Math.abs(Date.parse(next.timestamp) - Date.parse(last.timestamp)) < windowMs;
}
