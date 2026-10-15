import { describe, expect, it } from "vitest";
import { completeMention, encodeMentions, mentionMatches, mentionQuery, mentions, splitMentions } from "./mentions";

const people = [
	{ name: "Ana", deviceId: "KEYA" },
	{ name: "Ana Maria", deviceId: "KEYAM" },
	{ name: "Bo", deviceId: "KEYB" },
	{ name: "NoKey" },
];

describe("mentions", () => {
	it("turns @Name into a device key, longest name first, and leaves unknown names alone", () => {
		expect(encodeMentions("hi @Ana Maria and @Bo, also @Nobody and @NoKey", people)).toBe("hi <@KEYAM> and <@KEYB>, also @Nobody and @NoKey");
		expect(encodeMentions("hi @Ana.", people)).toBe("hi <@KEYA>.");
		// An email address is not a mention
		expect(encodeMentions("write to bo@Bo.com", people)).toBe("write to bo@Bo.com");
	});

	it("shows a mention as @Name and splits text around it", () => {
		expect(splitMentions("look <@KEYB> and <@GONE>!", people)).toEqual([
			{ text: "look ", mention: false },
			{ text: "@Bo", mention: true, key: "KEYB" },
			{ text: " and ", mention: false },
			{ text: "@someone", mention: true, key: "GONE" },
			{ text: "!", mention: false },
		]);
	});

	it("says whether a text mentions a device", () => {
		expect(mentions("hey <@KEYB>", "KEYB")).toBe(true);
		expect(mentions("hey <@KEYB>", "KEYA")).toBe(false);
		expect(mentions("hey", "")).toBe(false);
	});

	it("finds the word being typed after an @ and completes it", () => {
		expect(mentionQuery("hello @An", 9)).toEqual({ query: "An", start: 6 });
		expect(mentionQuery("hello", 5)).toBeNull();
		expect(mentionQuery("mail me@x", 9)).toBeNull();
		expect(mentionMatches("an", people).map((p) => p.name)).toEqual(["Ana", "Ana Maria"]);
		expect(mentionMatches("no", people)).toEqual([]);
		expect(completeMention("hello @An there", 6, 9, "Ana")).toEqual({ text: "hello @Ana  there", caret: 11 });
	});
});
