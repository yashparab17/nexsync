import { describe, expect, it } from "vitest";

import { applyToRuns, blockPropsOf, editedStyles, fromCaret, fromFile, galleryStyles, idFromName, isBuiltInWordId, toStyleIn, WORD_ID, type StyleOut } from "@/features/office/documents/lib/documentStyles";

const file: StyleOut = { id: "Callout", name: "Callout", basedOn: "Normal", font: "Georgia", size: 13, bold: true, italic: false, underline: false, color: "#c00000", align: "center", spaceBefore: 6, spaceAfter: 12, lineSpacing: 1.5, outline: 0, used: true };

describe("named styles in the editor", () => {
	it("takes a style of the file as the editor holds it, and gives it back as the backend takes it", () => {
		const d = fromFile(file);
		expect(d).toMatchObject({ id: "Callout", font: "Georgia", size: 13, bold: true, color: "#c00000", align: "center", basedOn: "Normal" });
		expect(d.edited).toBeUndefined();
		expect(toStyleIn(d)).toEqual({ id: "Callout", name: "Callout", basedOn: "Normal", font: "Georgia", size: 13, bold: true, italic: false, underline: false, color: "#c00000", align: "center", spaceBefore: 6, spaceAfter: 12, lineSpacing: 1.5 });
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
