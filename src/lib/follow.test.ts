import { describe, expect, it } from "vitest";

import { followEvents, type Snapshot } from "./follow";

const item = (over: Partial<Snapshot[string]> = {}) => ({ title: "Plan", assignee: "", sig: "a", ...over });

describe("followEvents", () => {
	it("announces nothing on the first check", () => {
		expect(followEvents(null, { "task:1": item({ assignee: "me" }) }, "me", new Set())).toEqual([]);
	});
	it("tells a person they were given an item, and follows it", () => {
		const events = followEvents({ "task:1": item() }, { "task:1": item({ assignee: "me", sig: "b" }) }, "me", new Set());
		expect(events).toHaveLength(1);
		expect(events[0].follow).toBe(true);
	});
	it("tells about a change to a followed item only", () => {
		const before = { "task:1": item(), "task:2": item() };
		const now = { "task:1": item({ sig: "b" }), "task:2": item({ sig: "b" }) };
		expect(followEvents(before, now, "me", new Set(["task:1"])).map((e) => e.key)).toEqual(["task:1"]);
	});
	it("ignores items that appeared since the last check", () => {
		expect(followEvents({}, { "card:9": item({ assignee: "me" }) }, "me", new Set())).toEqual([]);
	});
});
