import { describe, expect, it } from "vitest";
import type { LogEntry } from "@/features/chat/lib/entries";
import { canBan, canModerate, describeAction, moderationLog, noticeText, parseAction, reviewSummary, timeLeft } from "@/features/moderation/lib/moderation";

const entry = (body: object, over: Partial<LogEntry> = {}): LogEntry => ({ id: "e", kind: "moderation", channel: "moderation", parent: "", author: "A", name: "Ana", ts: 1000, body: JSON.stringify(body), sig: "s", ...over });

describe("who gets buttons", () => {
	it("lets the Owner act on anyone but the Owner, and an Admin on members below Admin", () => {
		expect(canModerate("Owner", "Admin")).toBe(true);
		expect(canModerate("Owner", "Owner")).toBe(false);
		expect(canModerate("Admin", "Editor")).toBe(true);
		expect(canModerate("Admin", "Admin")).toBe(false);
		expect(canModerate("Editor", "Viewer")).toBe(false);
		expect(canBan("Owner")).toBe(true);
		expect(canBan("Admin")).toBe(false);
	});
});

describe("words", () => {
	it("rounds a time left up and says it plainly", () => {
		const now = 1_000_000;
		expect(timeLeft(now + 30_000, now)).toBe("1 minute");
		expect(timeLeft(now + 10 * 60_000, now)).toBe("10 minutes");
		expect(timeLeft(now + 61 * 60_000, now)).toBe("2 hours");
		expect(timeLeft(now + 7 * 24 * 3_600_000, now)).toBe("7 days");
	});

	it("describes each act for the log, and leaves out the note that a removal was carried out", () => {
		expect(describeAction(entry({ action: "kick", targetName: "Bo", reason: "spam" }))).toBe("Ana removed Bo: spam");
		expect(describeAction(entry({ action: "ban", targetName: "Bo" }))).toBe("Ana banned Bo");
		expect(describeAction(entry({ action: "unban", targetName: "Bo" }))).toBe("Ana lifted the ban on Bo");
		expect(describeAction(entry({ action: "policy", requireTwo: true }))).toContain("two-person rule");
		expect(describeAction(entry({ action: "kicked", targetName: "Bo" }))).toBeNull();
		expect(describeAction({ ...entry({}), body: "not json" })).toBeNull();
		expect(parseAction("{\"action\":\"kick\"}")?.action).toBe("kick");
	});

	it("lists the log newest first without the bookkeeping entries", () => {
		const log = moderationLog([
			entry({ action: "kick", targetName: "Bo" }, { id: "1", ts: 100 }),
			entry({ action: "kicked", targetName: "Bo" }, { id: "2", ts: 150 }),
			entry({ action: "ban", targetName: "Cy" }, { id: "3", ts: 200 }),
			{ ...entry({}), kind: "message", id: "4", body: "hi" },
		]);
		expect(log.map((l) => l.id)).toEqual(["3", "1"]);
	});

	it("tells the member what happened to them", () => {
		expect(noticeText("timeout", "Ana", { until: Date.now() + 3_600_000, reason: "cool off" })).toContain("1 hour");
		expect(noticeText("ban", "Ana", {})).toContain("banned");
		expect(noticeText("unban", "Ana", {})).toContain("join again");
	});
});

describe("reviewSummary", () => {
	it("counts changes, items and people", () => {
		expect(reviewSummary([])).toBe("");
		expect(reviewSummary([{ record: "a", who: "Ana" }])).toBe("1 change to 1 item from Ana");
		expect(reviewSummary([{ record: "a", who: "Ana" }, { record: "b", who: "Bo" }, { record: "b", who: "Cy" }])).toBe("3 changes to 2 items from Ana, Bo and 1 more");
	});
});
