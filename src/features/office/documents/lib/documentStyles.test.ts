import { describe, expect, it } from "vitest";

import { applyToRuns, blockPropsOf, characterFrom, characterStyles, charMarks, editedStyles, fromCaret, fromFile, galleryStyles, idFromName, inherit, isBuiltInWordId, tableFrom, tableStyleCss, tableStyles, toStyleIn, WORD_ID, type StyleOut } from "@/features/office/documents/lib/documentStyles";

const file: StyleOut = { id: "Callout", name: "Callout", basedOn: "Normal", font: "Georgia", size: 13, bold: true, italic: false, underline: false, color: "#c00000", align: "center", spaceBefore: 6, spaceAfter: 12, lineSpacing: 1.5, outline: 0, used: true };

describe("named styles in the editor", () => {
	it("takes a style of the file as the editor holds it, and gives it back as the backend takes it", () => {
		const d = fromFile(file);
		expect(d).toMatchObject({ id: "Callout", font: "Georgia", size: 13, bold: true, color: "#c00000", align: "center", basedOn: "Normal" });
		expect(d.edited).toBeUndefined();
		expect(toStyleIn(d)).toEqual({ id: "Callout", name: "Callout", basedOn: "Normal", font: "Georgia", size: 13, bold: true, italic: false, underline: false, color: "#c00000", align: "center", spaceBefore: 6, spaceAfter: 12, lineSpacing: 1.5, kind: "", table: null });
		expect(fromFile({ ...file, align: "distribute", basedOn: null }).align).toBe("left");
	});

	it("puts the look on runs, taking bold off when the style is not bold and keeping the other styles of the run", () => {
		const d = fromFile({ ...file, bold: false, italic: true, color: "" });
		const out = applyToRuns({ bold: true, textColor: "#00ff00", backgroundColor: "#ffff00" }, d);
		expect(out).toEqual({ fontFamily: "Georgia", fontSize: "13pt", italic: true, backgroundColor: "#ffff00" });
		expect(applyToRuns({}, fromFile(file))).toEqual({ fontFamily: "Georgia", fontSize: "13pt", bold: true, textColor: "#c00000" });
	});

	it("sets the paragraph's own properties and says which style it is", () => {
		expect(blockPropsOf(fromFile(file))).toEqual({ styleId: "Callout", textAlignment: "center", spaceBefore: 6, spaceAfter: 12, lineSpacing: 1.5 });
	});

	it("makes an id from a name: letters and digits, not starting with a digit, and not one that is taken", () => {
		expect(idFromName("Pull quote!", [])).toBe("Pullquote");
		expect(idFromName("Pull quote", ["Pullquote"])).toBe("Pullquote2");
		expect(idFromName("pullquote", ["Pullquote", "pullquote2"])).toBe("pullquote3");
		expect(idFromName("3 columns", [])).toBe("S3columns");
		expect(idFromName("???", [])).toBe("Style");
	});

	it("makes a style from the look at the caret, and marks it as made here", () => {
		const d = fromCaret(" Note ", "Note", { font: "Arial", size: 11, bold: false, italic: true, underline: false, color: "" }, { textAlignment: "right", spaceBefore: -1, spaceAfter: 8, lineSpacing: 0 });
		expect(d).toMatchObject({ id: "Note", name: "Note", font: "Arial", italic: true, align: "right", spaceBefore: 0, spaceAfter: 8, lineSpacing: 1, edited: true });
	});

	it("sends only the styles made or changed here, and keeps the file's own looks of the gallery's styles out of the gallery", () => {
		const a = fromFile(file);
		const b = { ...fromFile({ ...file, id: "Title", name: "Title" }), edited: true };
		const h = { ...fromFile({ ...file, id: "Heading1", name: "Heading 1" }), edited: true };
		expect(editedStyles([a, b, h]).map((s) => s.id)).toEqual(["Title", "Heading1"]);
		expect(galleryStyles([b, h, a]).map((s) => s.id)).toEqual(["Callout", "Title"]);
		expect(isBuiltInWordId("Heading2") && !isBuiltInWordId("Callout")).toBe(true);
		expect(WORD_ID.h2).toBe("Heading2");
	});
});

describe("styles based on other styles, and styles of letters and tables", () => {
	const base = { ...fromFile(file), edited: true };
	it("makes a style based on another, and the based-on style follows the fields it did not change", () => {
		const warning = { ...fromCaret("Warning", "Warning", { font: "Georgia", size: 13, bold: true, italic: true, underline: false, color: "#c00000" }, { textAlignment: "center", spaceBefore: 6, spaceAfter: 12, lineSpacing: 1.5 }, "Callout") };
		expect(warning.basedOn).toBe("Callout");
		const bigger = { ...base, size: 20, color: "#0000ff" };
		const follows = inherit([base, warning], base, bigger);
		expect(follows).toHaveLength(1);
		expect(follows[0]).toMatchObject({ id: "Warning", size: 20, color: "#0000ff", italic: true, edited: true });
		// A field the style set for itself is not moved
		const own = { ...warning, size: 9 };
		expect(inherit([base, own], base, bigger)[0]).toMatchObject({ size: 9, color: "#0000ff" });
		// Nothing follows when nothing the style shares changed, and a chain follows through
		expect(inherit([base, warning], base, { ...base, name: "Renamed" })).toEqual([]);
		const third = { ...warning, id: "Alarm", basedOn: "Warning" };
		expect(inherit([base, warning, third], base, bigger).map((d) => d.id)).toEqual(["Warning", "Alarm"]);
	});

	it("keeps the three kinds apart", () => {
		const ch = characterFrom("Mark", "Mark", { font: "Arial", size: 11, bold: true, italic: false, underline: false, color: "#ff0000" });
		const tb = tableFrom("Plan", "Plan", { headerFill: "#d9e2f3", headerColor: "", headerBold: true, bandFill: "#f2f2f2", fill: "" });
		const all = [fromFile(file), ch, tb];
		expect(galleryStyles(all).map((d) => d.id)).toEqual(["Callout"]);
		expect(characterStyles(all).map((d) => d.id)).toEqual(["Mark"]);
		expect(tableStyles(all).map((d) => d.id)).toEqual(["Plan"]);
		expect(toStyleIn(ch).kind).toBe("character");
		expect(toStyleIn(tb)).toMatchObject({ kind: "table", table: { headerFill: "#d9e2f3" } });
		expect(toStyleIn(fromFile(file)).kind).toBe("");
		expect(editedStyles(all).map((s) => s.id)).toEqual(["Mark", "Plan"]);
	});

	it("puts a character style's id and look on words, and takes off what is off", () => {
		const ch = characterFrom("Mark", "Mark", { font: "Arial", size: 11, bold: true, italic: false, underline: false, color: "#ff0000" });
		expect(charMarks(ch)).toEqual({ on: { charStyle: "Mark", fontFamily: "Arial", fontSize: "11pt", bold: true, textColor: "#ff0000" }, off: ["italic", "underline"] });
	});

	it("draws a table style on the tables that use it", () => {
		const tb = tableFrom("Plan", "Plan", { headerFill: "#d9e2f3", headerColor: "#000000", headerBold: true, bandFill: "#f2f2f2", fill: "" });
		const css = tableStyleCss([tb], (id) => id);
		expect(css).toContain(':has([data-table-style="Plan"]) tr:first-child :is(td,th){background-color:#d9e2f3;font-weight:700;color:#000000;}');
		expect(css).toContain("tr:nth-child(even) :is(td,th){background-color:#f2f2f2}");
		// A colour that is not a colour is left out, so a style from a file cannot put anything else in the sheet
		expect(tableStyleCss([tableFrom("Bad", "Bad", { headerFill: "red;}body{display:none", headerColor: "", headerBold: false, bandFill: "", fill: "" })], (id) => id)).toBe("");
	});
});

