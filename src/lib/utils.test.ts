import { describe, expect, it } from "vitest";

import { colorForName } from "@/lib/collabColor";
import { errorText, formatBytes, getMimeType } from "@/lib/utils";

describe("utils", () => {
	it("maps extensions to MIME types case-insensitively", () => {
		expect(getMimeType("Photo.PNG")).toBe("image/png");
		expect(getMimeType("notes.unknown", "x/y")).toBe("x/y");
		expect(getMimeType("noextension")).toBe("application/octet-stream");
	});

	it("formats byte sizes", () => {
		expect(formatBytes(0)).toBe("0 Bytes");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
	});

	it("extracts readable error text", () => {
		expect(errorText(new Error("boom"), "x")).toBe("boom");
		expect(errorText("plain", "x")).toBe("plain");
		expect(errorText(42, "fallback")).toBe("fallback");
	});

	it("gives a collaborator the same color every time", () => {
		expect(colorForName("Ada")).toBe(colorForName("Ada"));
		expect(colorForName("Ada")).toMatch(/^hsl\(\d+, 70%, 55%\)$/);
	});
});
