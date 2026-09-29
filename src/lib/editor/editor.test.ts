import { javascript } from "@codemirror/lang-javascript";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { blameLines, blameRanges, contributions, recordAuthor, trackAuthor } from "./blame";
import { minimalChange } from "./format";
import { editorRouteFor, loadLanguage } from "./languages";
import { countSyntaxErrors } from "./syntax";

describe("file routing", () => {
	it("sends text documents to notes, office files to the system app and everything else to the editor", () => {
		expect(editorRouteFor("todo.md")).toBe("notes");
		expect(editorRouteFor("readme.TXT")).toBe("notes");
		expect(editorRouteFor("report.docx")).toBe("system");
		expect(editorRouteFor("logo.png")).toBe("system");
		expect(editorRouteFor("main.rs")).toBe("editor");
		expect(editorRouteFor("Dockerfile")).toBe("editor");
	});

	it("finds a language for common and less common file types", async () => {
		expect((await loadLanguage("app.py")).name).toBe("Python");
		expect((await loadLanguage("main.go")).name).toBe("Go");
		expect((await loadLanguage("query.sql")).name).toBe("SQL");
		expect((await loadLanguage("notes.md")).name).toBe("Markdown");
		expect((await loadLanguage("data.bin")).support).toBeNull();
	});
});

describe("minimalChange", () => {
	it("replaces only the part that differs", () => {
		expect(minimalChange("let a = 1;", "let a = 2;")).toEqual({ from: 8, to: 9, insert: "2" });
		expect(minimalChange("same", "same")).toBeNull();
		expect(minimalChange("ab", "abcd")).toEqual({ from: 2, to: 2, insert: "cd" });
	});
});

describe("syntax check after a merge", () => {
	const js = javascript();

	it("counts errors in broken code and none in valid code", () => {
		expect(countSyntaxErrors("function f() { return 1; }", js)).toBe(0);
		expect(countSyntaxErrors("function f() { return 1;", js)).toBeGreaterThan(0);
		expect(countSyntaxErrors("anything", null)).toBeNull();
	});

	it("notices when two people each fix the same missing brace and the merge keeps both", () => {
		const base = new Y.Doc();
		base.getText("t").insert(0, "function f() {\n  a();\n");
		const start = Y.encodeStateAsUpdate(base);
		const [a, b] = [new Y.Doc(), new Y.Doc()];
		[a, b].forEach((d) => Y.applyUpdate(d, start));
		a.getText("t").insert(a.getText("t").length, "}\n");
		b.getText("t").insert(b.getText("t").length, "}\n");
		const broken = countSyntaxErrors(base.getText("t").toString(), js) ?? 0;
		expect(broken).toBeGreaterThan(0);
		expect(countSyntaxErrors(a.getText("t").toString(), js)).toBe(0);
		expect(countSyntaxErrors(b.getText("t").toString(), js)).toBe(0);

		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		expect(countSyntaxErrors(a.getText("t").toString(), js)).toBeGreaterThan(0);
	});
});

describe("blame and contributions", () => {
	function twoAuthors() {
		const [ana, ben] = [new Y.Doc(), new Y.Doc()];
		ana.clientID = 1;
		ben.clientID = 2;
		trackAuthor(ana, "Ana");
		trackAuthor(ben, "Ben");
		ana.getText("t").insert(0, "one\ntwo\n");
		Y.applyUpdate(ben, Y.encodeStateAsUpdate(ana));
		ben.getText("t").insert(8, "three\nfour\n");
		Y.applyUpdate(ana, Y.encodeStateAsUpdate(ben));
		return { ana, ben };
	}

	it("attributes each line to the person who wrote it, on every device", () => {
		const { ana, ben } = twoAuthors();
		for (const doc of [ana, ben]) {
			const lines = blameLines(doc.getText("t"), doc.getMap("authors"));
			expect(lines).toEqual(["Ana", "Ana", "Ben", "Ben"]);
			expect(blameRanges(lines)).toEqual([
				{ author: "Ana", from: 1, to: 2 },
				{ author: "Ben", from: 3, to: 4 },
			]);
		}
	});

	it("keeps the author of text that someone else edited around", () => {
		const { ana } = twoAuthors();
		ana.getText("t").insert(1, "X");
		const lines = blameLines(ana.getText("t"), ana.getMap("authors"));
		expect(lines[0]).toBe("Ana");
	});

	it("totals what each person wrote and ignores deleted text", () => {
		const { ana } = twoAuthors();
		ana.getText("t").delete(0, 4);
		const result = contributions(ana.getText("t"), ana.getMap("authors"));
		expect(result.map((c) => [c.author, c.lines])).toEqual([
			["Ben", 2],
			["Ana", 1],
		]);
		expect(result.reduce((sum, c) => sum + c.percent, 0)).toBeGreaterThanOrEqual(99);
	});

	it("records an author only once per session", () => {
		const doc = new Y.Doc();
		recordAuthor(doc, "Zed");
		const first = doc.getMap<{ at: number }>("authors").get(String(doc.clientID))?.at;
		recordAuthor(doc, "Zed");
		expect(doc.getMap<{ at: number }>("authors").get(String(doc.clientID))?.at).toBe(first);
	});

	it("labels text with no recorded author as Unknown", () => {
		const doc = new Y.Doc();
		doc.getText("t").insert(0, "orphan");
		expect(blameLines(doc.getText("t"), doc.getMap("authors"))).toEqual(["Unknown"]);
	});
});
