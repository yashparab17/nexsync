import { describe, expect, it } from "vitest";

import { isEdit, isRepeat, visibleEvents } from "@/lib/activityFeed";
import type { ActivityEvent } from "@/types/workspace";

const at = (min: number) => new Date(Date.UTC(2026, 9, 31, 11, min)).toISOString();
const ev = (action: string, target: string, author: string, min: number): ActivityEvent => ({ id: `${action}${min}`, timestamp: at(min), action, detail: "", author, target });

describe("the activity feed", () => {
	it("counts a save soon after a save of the same item by the same person as the same line", () => {
		const last = [ev("Saved note", "notes/a.md", "Ana", 0)];
		expect(isRepeat(last, ev("Saved note", "notes/a.md", "Ana", 3))).toBe(true);
		expect(isRepeat(last, ev("Saved note", "notes/a.md", "Ana", 11))).toBe(false);
		expect(isRepeat(last, ev("Saved note", "notes/b.md", "Ana", 3))).toBe(false);
		expect(isRepeat(last, ev("Saved note", "notes/a.md", "Sam", 3))).toBe(false);
		expect(isRepeat([], ev("Saved note", "notes/a.md", "Ana", 3))).toBe(false);
	});

	it("never merges lines that are not saves, such as a created or deleted note", () => {
		const last = [ev("Created note", "notes/a.md", "Ana", 0)];
		expect(isRepeat(last, ev("Created note", "notes/a.md", "Ana", 1))).toBe(false);
		expect(isEdit(ev("Deleted note", "x", "Ana", 0))).toBe(false);
		expect(isEdit(ev("Saved file", "x", "Ana", 0))).toBe(true);
	});

	it("hides the saves from one person's feed on request and keeps everything else", () => {
		const all = [ev("Saved note", "a", "Ana", 0), ev("Created note", "b", "Ana", 1), ev("Saved file", "c", "Sam", 2)];
		expect(visibleEvents(all, false)).toHaveLength(3);
		expect(visibleEvents(all, true).map((e) => e.action)).toEqual(["Created note"]);
	});
});
