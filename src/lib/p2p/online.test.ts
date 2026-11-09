import { describe, expect, it } from "vitest";
import { isMemberOnline, onlineMemberIds } from "@/lib/p2p/online";

const peers = [{ id: "dev-a", name: "Sam" }];

describe("isMemberOnline", () => {
	it("matches on the device key, not the name", () => {
		expect(isMemberOnline({ id: "1", name: "Other", deviceId: "dev-a" }, peers)).toBe(true);
		expect(isMemberOnline({ id: "2", name: "Sam", deviceId: "dev-b" }, peers)).toBe(false);
	});
	it("falls back to the name only without a key", () => {
		expect(isMemberOnline({ id: "3", name: "sam" }, peers)).toBe(true);
	});
	it("treats this device as online", () => {
		expect(isMemberOnline({ id: "4", name: "Me" }, [], true)).toBe(true);
	});
	it("collects ids", () => {
		const ids = onlineMemberIds([{ id: "1", name: "Me" }, { id: "2", name: "Zed" }], peers, (m) => m.name === "Me");
		expect([...ids]).toEqual(["1"]);
	});
});
