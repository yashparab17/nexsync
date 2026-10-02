import { describe, expect, it } from "vitest";

import { followPath, lastSeenText, pageOf, parsePresence, placeLabel, probeText, whoIsAt, type PeerPresence } from "@/lib/p2p/presence";

describe("presence messages", () => {
	it("accepts a known page and drops anything else", () => {
		expect(parsePresence('{"page":"notes","item":"a/plan.md","away":true}')).toEqual({ page: "notes", item: "a/plan.md", away: true });
		expect(parsePresence('{"page":"notes"}')).toEqual({ page: "notes", item: null, away: false });
		expect(parsePresence('{"page":"https://evil"}')).toBeNull();
		expect(parsePresence('{"page":"notes","item":7}')).toBeNull();
		expect(parsePresence(`{"page":"notes","item":"${"x".repeat(301)}"}`)).toBeNull();
		expect(parsePresence("not json")).toBeNull();
		expect(parsePresence(undefined)).toBeNull();
	});

	it("reads the page from the route", () => {
		expect(pageOf("/workspace")).toBe("dashboard");
		expect(pageOf("/workspace/kanban")).toBe("kanban");
		expect(pageOf("/workspace/nope")).toBeNull();
		expect(pageOf("/")).toBeNull();
	});
});

describe("saying where", () => {
	it("names the page and the file, and links to them", () => {
		const here = { page: "notes", item: "docs/plan.md", away: false };
		expect(placeLabel(here)).toBe("Notes · plan.md");
		expect(placeLabel({ ...here, away: true })).toBe("Away, last on Notes · plan.md");
		expect(followPath(here)).toBe("/workspace/notes?open=docs%2Fplan.md");
		expect(followPath({ page: "dashboard", item: null, away: false })).toBe("/workspace");
	});

	it("finds who is on a page or has one thing open", () => {
		const at = (page: string, item: string | null): PeerPresence => ({ page, item, away: false, at: 0 });
		const all = { Raven: at("kanban", "c1"), Sam: at("kanban", null), Ana: at("notes", "a.md") };
		expect(whoIsAt(all, "kanban")).toEqual(["Raven", "Sam"]);
		expect(whoIsAt(all, "kanban", "c1")).toEqual(["Raven"]);
		expect(whoIsAt(all, "tasks")).toEqual([]);
	});

	it("says in one line whether a member could be reached by key", () => {
		const base = { reachable: true, connectMs: 1250, path: "direct" as const, directAfterMs: 1800, rttMs: 24, error: null };
		expect(probeText(base)).toBe("Reachable directly, 24 ms, connected in 1.3 s");
		expect(probeText({ ...base, path: "relay", directAfterMs: null })).toBe("Reachable through a relay, connected in 1.3 s");
		expect(probeText({ ...base, reachable: false, path: "none", error: "No addressing information available" })).toBe(
			"Not reachable from here: No addressing information available",
		);
	});

	it("words how long ago someone left", () => {
		const now = 10_000_000_000;
		expect(lastSeenText(now - 20_000, now)).toBe("just now");
		expect(lastSeenText(now - 5 * 60_000, now)).toBe("5 min ago");
		expect(lastSeenText(now - 3_600_000, now)).toBe("1 hour ago");
		expect(lastSeenText(now - 50 * 3_600_000, now)).toBe("2 days ago");
	});
});
