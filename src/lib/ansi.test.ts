import { describe, expect, it } from "vitest";

import { ansiPieces, plain } from "./ansi";

describe("ansi", () => {
	it("keeps the text and gives coloured pieces the theme's colours", () => {
		expect(ansiPieces("ok \u001b[31mfailed\u001b[0m done")).toEqual([
			{ text: "ok ", className: "" },
			{ text: "failed", className: "text-destructive" },
			{ text: " done", className: "" },
		]);
		expect(ansiPieces("\u001b[1;32mpass\u001b[0m")[0]).toEqual({ text: "pass", className: "text-success font-semibold" });
		expect(ansiPieces("\u001b[93mwarn")[0].className).toBe("text-warning");
	});
	it("drops codes that are not colours", () => {
		expect(plain("\u001b[2K\u001b[1Gloading\u001b[?25l")).toBe("loading");
		expect(plain("no codes")).toBe("no codes");
	});
});
