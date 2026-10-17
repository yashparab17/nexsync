import { describe, expect, it } from "vitest";

import { previewKind, textSnippet } from "@/features/assets/lib/previews";

describe("previewKind", () => {
	it("knows what can have a tile preview", () => {
		expect(previewKind("a.PDF")).toBe("pdf");
		expect(previewKind("clip.mp4")).toBe("video");
		expect(previewKind("notes.md")).toBe("text");
		expect(previewKind("song.mp3")).toBeNull();
	});
});

describe("textSnippet", () => {
	it("decodes only the start of a file", () => {
		const text = "héllo wörld\n".repeat(500);
		const base64 = btoa(unescape(encodeURIComponent(text)));
		const snippet = textSnippet(base64, 40);
		expect(snippet.startsWith("héllo wörld")).toBe(true);
		expect(snippet.length).toBeLessThanOrEqual(40);
	});
});
