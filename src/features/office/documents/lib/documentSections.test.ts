import { describe, expect, it } from "vitest";

import { formatSection, NEW_SECTION, parseSection, sectionCount, sectionStart } from "@/features/office/documents/lib/documentSections";

describe("sections in the editor", () => {
	it("reads and writes a section's set-up", () => {
		expect(parseSection("next|l|36,36,36,36|2")).toEqual({ ...NEW_SECTION, start: "next", landscape: true, margins: [36, 36, 36, 36], columns: 2 });
		expect(parseSection("cont|p||1")).toEqual({ ...NEW_SECTION, start: "cont" });
		expect(formatSection(parseSection("cont|p||3")!)).toBe("cont|p||3");
		expect(formatSection({ ...NEW_SECTION, margins: [72, 108, 72, 108] })).toBe("next|p|72,108,72,108|1");
		for (const bad of ["", "x|p||1", "next|q||1", "next|p||4", "next|p|1,2,3|1", "next|p|a,b,c,d|1", "next|p|-1,0,0,0|1"]) expect(parseSection(bad)).toBeNull();
	});

	it("finds the block that starts the section the caret is in, also from inside a nested block", () => {
		const top = [
			{ id: "a" },
			{ id: "b", props: { sectionBreak: "next|l||1" } },
			{ id: "c", children: [{ id: "c1" }] },
			{ id: "d", props: { sectionBreak: "cont|p||2" } },
			{ id: "e" },
		];
		expect(sectionStart(top, "a")).toBeNull();
		expect(sectionStart(top, "b")?.block.id).toBe("b");
		expect(sectionStart(top, "c1")?.block.id).toBe("b");
		expect(sectionStart(top, "e")?.spec).toEqual({ ...NEW_SECTION, start: "cont", columns: 2 });
		expect(sectionCount(top)).toBe(3);
	});

	it("carries a section's header and footer text as hex, including text with separators, and leaves them when there are none", () => {
		const spec = { ...NEW_SECTION, header: "Chapter 2 | Draft", footer: "" };
		const text = formatSection(spec);
		expect(text).not.toContain("Chapter");
		expect(text.split("|").length).toBe(6);
		expect(parseSection(text)).toEqual(spec);
		expect(parseSection(formatSection({ ...NEW_SECTION, header: "Chäpter ✓", footer: "Page foot" }))).toMatchObject({ header: "Chäpter ✓", footer: "Page foot" });
		expect(formatSection(NEW_SECTION)).toBe("next|p||1");
		expect(parseSection("next|p||1|=zz|")).toMatchObject({ header: null });
	});

	it("carries the start kind, the page number restart and the first and even page headers", () => {
		const spec = { ...NEW_SECTION, start: "even" as const, header: "A", num: 5, firstHeader: "Title", evenFooter: "Left" };
		const text = formatSection(spec);
		expect(text.startsWith("even|p||1|")).toBe(true);
		expect(parseSection(text)).toEqual(spec);
		expect(parseSection(formatSection({ ...NEW_SECTION, num: "c" }))?.num).toBe("c");
	});
});
