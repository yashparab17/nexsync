import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { clearProject, completionsOf, firstPlace, hoverText, lspTarget, offsetOf, problemsOf, setFileDiagnostics, severityOf } from "@/features/projects/lib/lsp";

describe("lsp", () => {
	it("finds an offset from a line and a character, clamped to the line", () => {
		const doc = Text.of(["let a = 1;", "", "const b = 22;"]);
		expect(offsetOf(doc, { line: 0, character: 4 })).toBe(4);
		expect(offsetOf(doc, { line: 2, character: 6 })).toBe(doc.line(3).from + 6);
		expect(offsetOf(doc, { line: 0, character: 999 })).toBe(10);
		expect(offsetOf(doc, { line: 99, character: 0 })).toBe(doc.line(3).from);
	});

	it("reads a hover in each of the forms servers use", () => {
		expect(hoverText({ contents: "plain" })).toBe("plain");
		expect(hoverText({ contents: { kind: "markdown", value: "```ts\nconst x: number\n```\n\nA number." } })).toBe("const x: number\n\nA number.");
		expect(hoverText({ contents: [{ language: "rust", value: "fn main()" }, "docs"] })).toBe("fn main()\n\ndocs");
		expect(hoverText(null)).toBe("");
		expect(hoverText({ contents: "x".repeat(5000) })).toHaveLength(2000);
	});

	it("takes the first place of a definition answer in any shape", () => {
		const range = { start: { line: 4, character: 2 }, end: { line: 4, character: 5 } };
		expect(firstPlace({ uri: "file:///a.ts", range, rel: "a.ts" })).toEqual({ rel: "a.ts", uri: "file:///a.ts", line: 4, character: 2 });
		expect(firstPlace([{ targetUri: "file:///b.ts", targetRange: range, targetSelectionRange: { start: { line: 9, character: 0 }, end: range.end } }])?.line).toBe(9);
		expect(firstPlace([])).toBeNull();
		expect(firstPlace(null)).toBeNull();
	});

	it("turns completion answers into editor completions, in the server's order, with the range it asked to replace", () => {
		const doc = Text.of(["console.lo"]);
		const got = completionsOf({ items: [{ label: "warn", kind: 2, sortText: "b" }, { label: "log", kind: 3, sortText: "a", textEdit: { newText: "log", range: { start: { line: 0, character: 8 }, end: { line: 0, character: 10 } } } }, { notLabel: 1 }] }, doc);
		expect(got.map((c) => c.label)).toEqual(["log", "warn"]);
		expect(got[0]).toMatchObject({ type: "function", apply: "log", from: 8, to: 10 });
		expect(got[1]).toMatchObject({ type: "method", apply: "warn" });
		expect(completionsOf([{ label: "x" }], doc)).toHaveLength(1);
		expect(completionsOf(null, doc)).toEqual([]);
	});

	it("maps severities and project files", () => {
		expect([1, 2, 3, 4, undefined].map(severityOf)).toEqual(["error", "warning", "info", "info", "error"]);
		expect(lspTarget("projects/app/src/a.ts")).toEqual({ project: "app", rel: "src/a.ts" });
		expect(lspTarget("/projects/app/a.ts")).toEqual({ project: "app", rel: "a.ts" });
		expect(lspTarget("notes/a.md")).toBeNull();
	});

	it("lists errors before warnings for the Problems tab and leaves out information", () => {
		const at = (line: number) => ({ start: { line, character: 1 }, end: { line, character: 4 } });
		setFileDiagnostics("app", "b.ts", [{ range: at(3), severity: 2, message: "unused" }, { range: at(0), severity: 3, message: "hint" }]);
		setFileDiagnostics("app", "a.ts", [{ range: at(7), severity: 1, message: "bad\nmore" }]);
		setFileDiagnostics("other", "z.ts", [{ range: at(0), severity: 1, message: "elsewhere" }]);
		const all = [
			{ project: "app", rel: "b.ts", diagnostics: [{ range: at(3), severity: 2, message: "unused" }, { range: at(0), severity: 3, message: "hint" }] },
			{ project: "app", rel: "a.ts", diagnostics: [{ range: at(7), severity: 1, message: "bad\nmore" }] },
			{ project: "other", rel: "z.ts", diagnostics: [{ range: at(0), severity: 1, message: "elsewhere" }] },
		];
		expect(problemsOf(all, "app").map((p) => [p.file, p.line, p.column, p.severity, p.message])).toEqual([["a.ts", 8, 2, "error", "bad"], ["b.ts", 4, 2, "warning", "unused"]]);
		clearProject("app");
		clearProject("other");
	});
});
