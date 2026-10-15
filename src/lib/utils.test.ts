import { describe, expect, it } from "vitest";

import { colorOf, NEUTRAL } from "@/lib/collabColor";
import { cleanPath, errorText, formatBytes, getMimeType } from "@/lib/utils";

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

	it("gives nobody a colour from their name: grey until they have chosen one", () => {
		expect(colorOf("Ada")).toBe(NEUTRAL);
		expect(colorOf("Bo")).toBe(NEUTRAL);
	});
});

describe("cleanPath", () => {
	it("drops the Windows extended-length prefix and leaves other paths alone", () => {
		expect(cleanPath("\\\\?\\E:\\nexsynctest\\Test 123")).toBe("E:\\nexsynctest\\Test 123");
		expect(cleanPath("\\\\?\\UNC\\srv\\share\\w")).toBe("\\\\srv\\share\\w");
		expect(cleanPath("/home/yash/code")).toBe("/home/yash/code");
	});
});
