import { describe, expect, it } from "vitest";

import type { LogEntry } from "./chat/entries";
import { colorOf, NEUTRAL, PALETTE } from "./collabColor";
import { ensureLocalColor, getLocalProfile, parseProfile, profilesFromEntries, setProfiles } from "./profile";

const entry = (author: string, name: string, ts: number, body: string): LogEntry => ({ id: `${author}${ts}`, kind: "profile", channel: "profiles", parent: "", author, name, ts, body, sig: "" });

describe("profiles", () => {
	it("accepts a colour from the palette and a small picture, and nothing else", () => {
		expect(parseProfile(JSON.stringify({ color: PALETTE[2], image: "data:image/webp;base64,AAAA" }))).toEqual({ color: PALETTE[2], image: "data:image/webp;base64,AAAA" });
		expect(parseProfile('{"color":"#123456"}')).toEqual({});
		expect(parseProfile('{"image":"javascript:alert(1)"}')).toEqual({});
		expect(parseProfile("nope")).toBeNull();
	});

	it("takes the newest profile of each author, by the name it was written under", () => {
		const map = profilesFromEntries([entry("a", "Ana", 1, JSON.stringify({ color: PALETTE[0] })), entry("a", "Ana", 2, JSON.stringify({ color: PALETTE[1] })), entry("b", "Bo", 1, "{}")]);
		expect(map.get("ana")?.color).toBe(PALETTE[1]);
		expect(map.has("bo")).toBe(false);
	});

	it("colours a person only by what they chose, and grey otherwise", () => {
		setProfiles(new Map([["cy", { color: PALETTE[3] }]]));
		expect(colorOf("CY ")).toBe(PALETTE[3]);
		expect(colorOf("Dee")).toBe(NEUTRAL);
		setProfiles(new Map());
		expect(colorOf("Cy")).toBe(NEUTRAL);
	});

	it("gives a person a random colour from the palette once, and keeps it", () => {
		localStorage.removeItem("nexsync-profile");
		const first = ensureLocalColor();
		expect(PALETTE).toContain(first.color);
		expect(ensureLocalColor().color).toBe(first.color);
		expect(getLocalProfile().color).toBe(first.color);
	});
});
