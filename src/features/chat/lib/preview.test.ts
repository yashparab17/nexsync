import { describe, expect, it } from "vitest";
import { plainPreview } from "@/features/chat/lib/preview";

describe("plainPreview", () => {
	it("shows mentions as names, drops formatting and line breaks, and shortens long text", () => {
		const people = [{ name: "Bo", deviceId: "KEYB" }];
		expect(plainPreview("hey <@KEYB>\n**look** at `this`", people)).toBe("hey @Bo look at this");
		expect(plainPreview("x".repeat(200), people, 20)).toBe(`${"x".repeat(19)}…`);
		expect(plainPreview("```ts\nconst a = 1;\n```", people)).toBe("const a = 1;");
	});
});
