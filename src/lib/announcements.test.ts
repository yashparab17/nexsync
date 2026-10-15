import { describe, expect, it } from "vitest";

import type { LogEntry } from "./chat/entries";
import { acknowledged, buildAnnouncements, expiryOf, forMe, ordered, statusOf, timeUntil, waitingForMe, CHANNEL } from "./announcements";

let n = 0;
const entry = (kind: LogEntry["kind"], over: Partial<LogEntry> = {}): LogEntry => ({ id: `e${++n}`, kind, channel: CHANNEL, parent: "", author: "owner", name: "Owen", ts: 1_000, body: "", sig: "s", ...over });
const post = (body: object, over: Partial<LogEntry> = {}) => entry("announce", { body: JSON.stringify({ title: "Release", level: "important", ...body }), ...over });

describe("announcements", () => {
	it("reads the newest version, marks it edited, and leaves out one that is not an announcement", () => {
		const a = post({ title: "Friday" }, { ts: 10 });
		const edit = post({ title: "Monday" }, { parent: a.id, ts: 20 });
		const bad = entry("announce", { body: "not json" });
		const list = buildAnnouncements([a, edit, bad], 100);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ title: "Monday", edited: true, ts: 10, updatedAt: 20 });
	});

	it("shows scheduled, ended and withdrawn ones as such", () => {
		const scheduled = post({ notBefore: 500 }, { ts: 1 });
		const ended = post({ ends: 50 }, { ts: 2 });
		const gone = post({}, { ts: 3 });
		const end = entry("announce_end", { parent: gone.id, name: "Ann" });
		const by = Object.fromEntries(buildAnnouncements([scheduled, ended, gone, end], 100).map((a) => [a.id, statusOf(a, 100)]));
		expect(by).toEqual({ [scheduled.id]: "scheduled", [ended.id]: "ended", [gone.id]: "withdrawn" });
	});

	it("counts each member's acknowledgement once, by the earliest, and asks only the people it is for", () => {
		const a = post({ audience: { roles: ["Editor"], members: [] } });
		const acks = [entry("ack", { parent: a.id, author: "bo", ts: 30 }), entry("ack", { parent: a.id, author: "bo", ts: 20 }), entry("ack", { parent: a.id, author: "cy", ts: 25 })];
		const [x] = buildAnnouncements([a, ...acks], 100);
		expect(x.acks.map((k) => [k.key, k.ts])).toEqual([["bo", 20], ["cy", 25]]);
		expect(acknowledged(x, "bo")).toBe(true);
		expect(forMe(x, "dee", "Editor")).toBe(true);
		expect(forMe(x, "dee", "Viewer")).toBe(false);
		expect(forMe(x, "dee", "Admin")).toBe(true);
		expect(waitingForMe([x], "dee", "Editor", 100)).toHaveLength(1);
		expect(waitingForMe([x], "bo", "Editor", 100)).toHaveLength(0);
		expect(waitingForMe([x], "owner", "Owner", 100)).toHaveLength(0);
	});

	it("does not ask for an acknowledgement of Info, and names members it is for", () => {
		const info = post({ level: "info", audience: { roles: [], members: ["bo"] } });
		const [x] = buildAnnouncements([info], 100);
		expect(waitingForMe([x], "bo", "Viewer", 100)).toHaveLength(0);
		expect(forMe(x, "bo", "Viewer")).toBe(true);
		expect(forMe(x, "cy", "Viewer")).toBe(false);
	});

	it("pins at most three and puts them first", () => {
		const list = [1, 2, 3, 4, 5].map((i) => post({ title: `t${i}`, pinned: i !== 5 }, { ts: i }));
		const out = ordered(buildAnnouncements(list, 100), 100);
		expect(out.slice(0, 3).every((a) => a.pinned)).toBe(true);
		expect(out).toHaveLength(5);
		expect(out.slice(0, 3).map((a) => a.title)).toEqual(["t4", "t3", "t2"]);
	});

	it("takes the newest expiry, treats 0 as cancelled, and hides an announcement once it has expired", () => {
		const a = post({});
		const set = (at: number, ts: number) => entry("expire", { body: JSON.stringify({ entity: "announcement", id: a.id, at }), ts });
		expect(expiryOf([set(500, 1), set(900, 2)], "announcement", a.id)).toBe(900);
		expect(expiryOf([set(500, 1), set(0, 2)], "announcement", a.id)).toBe(0);
		expect(buildAnnouncements([a, set(500, 1)], 400)).toHaveLength(1);
		expect(buildAnnouncements([a, set(500, 1)], 600)).toHaveLength(0);
	});

	it("says how long is left", () => {
		expect(timeUntil(130_000, 0)).toBe("3 min");
		expect(timeUntil(3 * 3_600_000, 0)).toBe("3 h");
		expect(timeUntil(3 * 86_400_000, 0)).toBe("3 days");
	});
});
