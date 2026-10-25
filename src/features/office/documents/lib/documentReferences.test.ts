import { describe, expect, it } from "vitest";

import { bibliography, citation, equationText, indexEntries, mailMerge, parseCsv, withFormula } from "@/features/office/documents/lib/documentReferences";

describe("document references and merge", () => {
	it("works out table formulas upwards and leftwards", () => {
		const t = { type: "tableContent" as const, rows: [{ cells: ["Item", "Cost"] }, { cells: ["a", "10"] }, { cells: ["b", "$5.5"] }, { cells: ["Total", ""] }] };
		expect(JSON.stringify(withFormula(t, 3, 1, "sumAbove")!.rows[3].cells[1])).toContain("15.5");
		expect(withFormula(t, 0, 1, "sumAbove")).toBeNull();
		expect(JSON.stringify(withFormula(t, 2, 1, "avgAbove")!.rows[2].cells[1])).toContain('"10"');
	});
	it("writes equations", () => {
		expect(equationText("E = m c^2")).toBe("E = m c²");
		expect(equationText("\\alpha_1 + \\frac{a}{b}")).toBe("α₁ + (a)⁄(b)");
		expect(equationText("\\sqrt{x}")).toBe("√(x)");
	});
	it("cites and lists sources", () => {
		const s = { id: "1", author: "Smith, Jo", year: "2020", title: "A Book", publisher: "Press" };
		expect(citation(s, "APA", 1)).toBe("(Smith, 2020)");
		expect(citation(s, "IEEE", 3)).toBe("[3]");
		expect(bibliography([s], "APA")[0]).toBe("Smith, Jo (2020). A Book. Press.");
		expect(bibliography([s], "IEEE")[0]).toContain('[1] Smith, Jo, "A Book,"');
	});
	it("indexes highlighted words", () => {
		const b = [{ content: [{ type: "text", text: "zeta", styles: { backgroundColor: "#ff0" } }, { type: "text", text: "plain", styles: {} }, { type: "text", text: "alpha", styles: { backgroundColor: "#ff0" } }] }];
		expect(indexEntries(b)).toEqual(["alpha", "zeta"]);
	});
	it("merges rows into copies", () => {
		expect(parseCsv('name,city\n"Doe, Jo",Paris\nAl,Rome\n')).toEqual([
			{ name: "Doe, Jo", city: "Paris" },
			{ name: "Al", city: "Rome" },
		]);
		const out = mailMerge([{ id: "x", type: "paragraph", content: [{ type: "text", text: "Dear {{name}}", styles: {} }] }], [{ name: "A" }, { name: "B" }]);
		expect(out).toHaveLength(2);
		expect(JSON.stringify(out[0])).toContain("Dear A");
		expect(out[1].props).toMatchObject({ pageBreakBefore: true });
		expect(out[0].id).toBeUndefined();
	});
	it("reads rows pasted from a sheet or given as JSON", () => {
		expect(parseCsv("name\tcity\nAna\tParis")).toEqual([{ name: "Ana", city: "Paris" }]);
		expect(parseCsv('[{"name":"Ana","n":3}]')).toEqual([{ name: "Ana", n: "3" }]);
		expect(parseCsv("[broken")).toEqual([]);
	});
});
