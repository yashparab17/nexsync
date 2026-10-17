import { describe, expect, it } from "vitest";

import { safeUploadName, validateFileName, validateWorkspaceName } from "@/lib/validation";

describe("validateFileName", () => {
	it("accepts ordinary names and leaves an empty one to the dialog", () => {
		expect(validateFileName("notes.md")).toBeNull();
		expect(validateFileName("Meeting notes (final) v2.txt")).toBeNull();
		expect(validateFileName("")).toBeNull();
	});
	it("rejects names that are too long", () => {
		expect(validateFileName("a".repeat(300) + ".md")).toMatch(/too long/);
		// 255 bytes, not characters: multi-byte characters count more
		expect(validateFileName("é".repeat(200))).toMatch(/too long/);
	});
	it("rejects slashes, other characters Windows forbids, and bad endings", () => {
		expect(validateFileName("a/b")).toMatch(/slashes/);
		expect(validateFileName("what?")).toMatch(/“\?”/);
		expect(validateFileName("name.")).toMatch(/dot or a space/);
		expect(validateFileName("..")).toMatch(/not allowed/);
	});
	it("rejects names Windows reserves", () => {
		expect(validateFileName("CON")).toMatch(/reserved/);
		expect(validateFileName("nul.txt")).toMatch(/reserved/);
		expect(validateFileName("console.txt")).toBeNull();
	});
});

describe("validateWorkspaceName", () => {
	it("has its own shorter limit", () => {
		expect(validateWorkspaceName("a".repeat(81))).toMatch(/80 characters/);
		expect(validateWorkspaceName("MSc research")).toBeNull();
	});
});

describe("safeUploadName", () => {
	it("replaces odd characters and shortens a long name, keeping the extension", () => {
		expect(safeUploadName("my file (1).png")).toBe("my_file__1_.png");
		const long = safeUploadName("x".repeat(400) + ".pdf");
		expect(long.length).toBe(200);
		expect(long.endsWith(".pdf")).toBe(true);
	});
});
