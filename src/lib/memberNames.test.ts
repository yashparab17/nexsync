import { describe, expect, it } from "vitest";

import { cleanName, freeName, nameProblem } from "@/lib/memberNames";
import type { Member } from "@/types/workspace";

const members: Member[] = [
	{ id: "o", name: "Sam", role: "Owner" },
	{ id: "a", name: "Sam (2)", role: "Editor", deviceId: "k" },
];

describe("member names", () => {
	it("cleans a name", () => {
		expect(cleanName("  Raven\u0007 \n")).toBe("Raven");
		expect(cleanName("x".repeat(100))).toHaveLength(64);
	});

	it("refuses a name somebody else has, whatever the capitals", () => {
		expect(nameProblem(members, "sam")).toMatch(/already called/);
		expect(nameProblem(members, " SAM (2) ")).toMatch(/already called/);
		expect(nameProblem(members, "")).toBe("Enter a name.");
		expect(nameProblem(members, "Raven")).toBeNull();
	});

	it("lets a member keep or re-capitalise their own name", () => {
		expect(nameProblem(members, "sam (2)", "a")).toBeNull();
	});

	it("gives the newest person the next free number", () => {
		expect(freeName(members, "Sam")).toBe("Sam (3)");
		expect(freeName(members, "Raven")).toBe("Raven");
		expect(freeName([], "  ")).toBe("Collaborator");
	});
});
