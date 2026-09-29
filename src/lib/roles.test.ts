import { describe, expect, it } from "vitest";

import { bindGuestMember, canChangeRole, roleTable } from "./roles";
import type { Member } from "@/types/workspace";

const owner: Member = { id: "o", name: "Owen", role: "Owner" };

describe("canChangeRole", () => {
	it("lets the owner manage everyone but the owner", () => {
		expect(canChangeRole("Owner", "Editor", "Admin")).toBe(true);
		expect(canChangeRole("Owner", "Admin", "Viewer")).toBe(true);
		expect(canChangeRole("Owner", "Owner", "Viewer")).toBe(false);
		expect(canChangeRole("Owner", "Editor", "Owner")).toBe(false);
	});

	it("lets an admin manage editors and viewers only", () => {
		expect(canChangeRole("Admin", "Viewer", "Editor")).toBe(true);
		expect(canChangeRole("Admin", "Editor", "Admin")).toBe(false);
		expect(canChangeRole("Admin", "Admin", "Viewer")).toBe(false);
		expect(canChangeRole("Admin", "Owner", "Viewer")).toBe(false);
	});

	it("gives editors and viewers no say", () => {
		expect(canChangeRole("Editor", "Viewer", "Editor")).toBe(false);
		expect(canChangeRole("Viewer", "Viewer", "Editor")).toBe(false);
	});
});

describe("bindGuestMember", () => {
	const peer = { id: "dev-1", name: "Ana", role: "Editor" };

	it("adds a new device as a member keyed by its device key", () => {
		const result = bindGuestMember([owner], peer, () => "m1");
		expect(result[1]).toEqual({ id: "m1", name: "Ana", role: "Editor", deviceId: "dev-1" });
	});

	it("leaves a known device alone so a promoted role sticks", () => {
		const members = [owner, { id: "m1", name: "Ana", role: "Admin", deviceId: "dev-1" }];
		expect(bindGuestMember(members, peer)).toBe(members);
	});

	it("does not let a new device take over another member's name", () => {
		const members = [owner, { id: "m1", name: "Ana", role: "Admin", deviceId: "dev-1" }];
		const result = bindGuestMember(members, { id: "dev-2", name: "ana", role: "Editor" }, () => "m2");
		expect(result[2]).toMatchObject({ name: "ana (2)", role: "Editor", deviceId: "dev-2" });
		expect(bindGuestMember([owner], { id: "dev-3", name: "Owen", role: "Editor" }, () => "m3")[1].name).toBe("Owen (2)");
	});

	it("lets the first device claim a member made before device keys", () => {
		const members = [owner, { id: "m1", name: "Ana", role: "Viewer" }];
		expect(bindGuestMember(members, peer)[1]).toEqual({ id: "m1", name: "Ana", role: "Editor", deviceId: "dev-1" });
	});
});

describe("roleTable", () => {
	it("lists devices and skips the owner and members with no device", () => {
		const members: Member[] = [
			{ ...owner, deviceId: "host" },
			{ id: "a", name: "A", role: "Admin", deviceId: "d1" },
			{ id: "b", name: "B", role: "Viewer" },
		];
		expect(roleTable(members)).toEqual([["d1", "Admin"]]);
	});
});
