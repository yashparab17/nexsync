import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (options: unknown) => save(options) }));
vi.mock("@/lib/tauri", () => ({
	exportZip: vi.fn(async () => 7),
	writeExportFile: vi.fn(async () => {}),
	uint8ArrayToBase64: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
}));

import { exportZip, writeExportFile } from "@/lib/tauri";
import { exportFolders, exportNote } from "./index";

beforeEach(() => vi.clearAllMocks());

describe("exportNote", () => {
	it("saves the note text as Markdown where the person chose, adding the extension", async () => {
		save.mockResolvedValue("C:/out/plan");
		const dest = await exportNote("/w", "plan.md", "# Plan", "md");
		expect(dest).toBe("C:/out/plan.md");
		expect(save.mock.calls[0][0]).toMatchObject({ defaultPath: "plan.md" });
		expect(writeExportFile).toHaveBeenCalledWith("/w", "C:/out/plan.md", btoa("# Plan"));
	});

	it("writes a PDF", async () => {
		save.mockResolvedValue("C:/out/notes.pdf");
		await exportNote("/w", "notes.txt", "hello", "pdf");
		const written = vi.mocked(writeExportFile).mock.calls[0][2];
		expect(atob(written).startsWith("%PDF-1.4")).toBe(true);
	});

	it("does nothing when the person cancels", async () => {
		save.mockResolvedValue(null);
		expect(await exportNote("/w", "a.md", "x", "md")).toBeNull();
		expect(writeExportFile).not.toHaveBeenCalled();
	});
});

describe("exportFolders", () => {
	it("zips the folders and reports how many files went in", async () => {
		save.mockResolvedValue("C:/out/backup.zip");
		expect(await exportFolders("/w", ["editor"], "backup")).toEqual({ dest: "C:/out/backup.zip", count: 7 });
		expect(exportZip).toHaveBeenCalledWith("/w", ["editor"], "C:/out/backup.zip");
	});

	it("does nothing when the person cancels", async () => {
		save.mockResolvedValue(null);
		expect(await exportFolders("/w", ["editor"], "backup")).toBeNull();
		expect(exportZip).not.toHaveBeenCalled();
	});
});
