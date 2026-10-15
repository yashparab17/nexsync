import { describe, expect, it } from "vitest";

import { arrivedLate, laneOf, stops, valuesAt, type LoggedWrite } from "./timescrub";

const w = (path: string, ts: number, value: string, who = "Ana", seenAt = ts): LoggedWrite => ({ path, ts, who, by: "", replica: "r", value: JSON.stringify(value), seenAt });

describe("time scrub", () => {
	const log = [w("title", 10, "a"), w("status", 20, "todo"), w("title", 30, "b", "Bo"), w("title", 40, "c", "Ana", 9_000_000)];
	it("stops at each distinct write time", () => {
		expect(stops([...log, w("x", 30, "dup")])).toEqual([10, 20, 30, 40]);
	});
	it("shows each field as it was at the moment", () => {
		expect(valuesAt(log, 25).get("title")?.value).toBe('"a"');
		expect(valuesAt(log, 35).get("title")?.value).toBe('"b"');
		expect(valuesAt(log, 5).size).toBe(0);
		expect([...valuesAt(log, 40).keys()].sort()).toEqual(["status", "title"]);
	});
	it("names the writer and flags a write that reached this device much later", () => {
		expect(laneOf(log[2])).toBe("Bo");
		expect(laneOf({ ...log[0], who: "", by: "abcdefghijkl" })).toBe("abcdefgh");
		expect(arrivedLate(log[3])).toBe(true);
		expect(arrivedLate(log[0])).toBe(false);
	});
});
