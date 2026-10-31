import { beforeEach, describe, expect, it, vi } from "vitest";

import { hasFolder, importSorted, placeOf, sortSummary } from "@/lib/dropSort";

const written: string[] = [];
vi.mock("@/lib/tauri", () => ({
	listWorkspaceFiles: async () => [],
	writeWorkspaceBinaryFile: async (_ws: string, rel: string) => void written.push(rel),
}));
vi.mock("@/features/assets/lib/uploadScale", () => ({ readFileBase64: async () => "" }));

const item = (rel: string) => ({ file: new File(["x"], rel.split("/").pop()!), rel });
beforeEach(() => (written.length = 0));

describe("sorting a dropped folder", () => {
	it("knows where each kind belongs", () => {
		expect(["a.PNG", "b.mp4", "c.pdf"].map(placeOf)).toEqual(["assets", "assets", "assets"]);
		expect(["a.docx", "b.xlsx", "c.pptx", "d.md", "e.rs"].map(placeOf)).toEqual(["documents", "sheets", "slides", "notes", "others"]);
	});

	it("sends each file to its folder, keeps folders only in Others, and skips system files", async () => {
		const result = await importSorted("/w", [item("trip/a.png"), item("trip/day2/a.png"), item("trip/plan.docx"), item("trip/notes.md"), item("trip/src/main.rs"), item("trip/.DS_Store")]);
		expect(written.sort()).toEqual(["assets/a (2).png", "assets/a.png", "notes/notes.md", "office/documents/plan.docx", "others/trip/src/main.rs"].sort());
		expect(result.skipped).toBe(1);
		expect(sortSummary(result)).toBe("Added 2 to Assets, 1 to Documents, 1 to Notes, 1 to Others.");
	});

	it("tells a folder drop from single files", () => {
		expect(hasFolder([item("a.png")])).toBe(false);
		expect(hasFolder([item("pics/a.png")])).toBe(true);
	});
});
