import { describe, expect, it } from "vitest";
import { groupInbox } from "@/features/shell/lib/inboxGroups";
import type { InboxItem } from "@/lib/tauri";

const item = (id: number, kind: string, at: number): InboxItem => ({ id, kind, reference: "", channel: "", author: "", snippet: "", at, read: false });

describe("groupInbox", () => {
	it("splits mentions, assigned and the rest, newest first, and drops empty groups", () => {
		const groups = groupInbox([item(1, "notice", 5), item(2, "mention", 1), item(3, "reply", 9), item(4, "follow", 2)]);
		expect(groups.map((g) => g.key)).toEqual(["mentions", "other"]);
		expect(groups[0].items.map((i) => i.id)).toEqual([3, 2]);
		expect(groups[1].items.map((i) => i.id)).toEqual([1, 4]);
	});
	it("returns nothing for an empty inbox", () => {
		expect(groupInbox([])).toEqual([]);
	});
});
