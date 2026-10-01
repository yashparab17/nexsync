import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/tauri", () => ({
	listFileVersions: vi.fn(),
	readFileVersion: vi.fn(),
	readWorkspaceFile: vi.fn(),
	recordFileVersion: vi.fn(),
	restoreFileVersion: vi.fn(),
}));

import { listFileVersions, readFileVersion, readWorkspaceFile, recordFileVersion, restoreFileVersion } from "@/lib/tauri";
import type { FileVersion } from "@/types/workspace";
import FileHistoryDialog from "./FileHistoryDialog";

const version = (id: number, over: Partial<FileVersion> = {}): FileVersion => ({
	id,
	path: "notes/a.md",
	hash: `h${id}`,
	size: 10,
	source: "save",
	label: null,
	author: null,
	createdAt: `2026-01-0${id}T10:00:00Z`,
	...over,
});
const texts: Record<number, string> = { 1: "one\ntwo\n", 2: "one\nthree\n" };

beforeEach(() => {
	vi.mocked(listFileVersions).mockResolvedValue([version(2), version(1, { source: "auto" })]);
	vi.mocked(readFileVersion).mockImplementation(async (_path, id) => texts[id]);
	vi.mocked(readWorkspaceFile).mockResolvedValue("one\nthree\nfour\n");
	vi.mocked(recordFileVersion).mockResolvedValue();
	vi.mocked(restoreFileVersion).mockResolvedValue("assets/pic.png");
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const open = (props: Partial<React.ComponentProps<typeof FileHistoryDialog>> = {}) =>
	render(<FileHistoryDialog workspacePath="/w" path="notes/a.md" currentText={"one\nthree\nfour\n"} onClose={() => {}} {...props} />);

describe("FileHistoryDialog", () => {
	it("lists versions newest first and shows what changed since the selected one", async () => {
		open();
		expect(await screen.findByText("four")).toBeTruthy();
		expect(screen.getByText("+1")).toBeTruthy();
		const list = screen.getByRole("list", { name: "Versions" });
		expect(list.textContent).toContain("Saved");
		expect(list.textContent).toContain("Auto-saved");
		expect(list.textContent!.indexOf("Saved")).toBeLessThan(list.textContent!.indexOf("Auto-saved"));
	});

	it("compares a version with the one before it", async () => {
		open();
		await screen.findByText("four");
		fireEvent.click(screen.getByRole("button", { name: "Changes in this version" }));
		await waitFor(() => expect(screen.getByText("-1")).toBeTruthy());
		expect(screen.getByText("+1")).toBeTruthy();
	});

	it("puts a text version back into the editor and closes", async () => {
		const onRestoreText = vi.fn();
		const onClose = vi.fn();
		open({ onRestoreText, onClose });
		await screen.findByText("four");
		await waitFor(() => expect((screen.getByRole("button", { name: /restore this version/i }) as HTMLButtonElement).disabled).toBe(false));
		fireEvent.click(screen.getByRole("button", { name: /restore this version/i }));
		expect(onRestoreText).toHaveBeenCalledWith("one\nthree\n");
		expect(onClose).toHaveBeenCalled();
	});

	it("cannot restore a text file that is not open in an editor, and says where to do it", async () => {
		open({ currentText: undefined });
		expect(await screen.findByText(/open the file in notes or editor/i)).toBeTruthy();
		expect((screen.getByRole("button", { name: /restore this version/i }) as HTMLButtonElement).disabled).toBe(true);
		// the file on disk is what it is compared with
		expect(await screen.findByText("four")).toBeTruthy();
	});

	it("names the current text as a version", async () => {
		open();
		await screen.findByText("four");
		fireEvent.change(screen.getByLabelText("Version name"), { target: { value: "Before review" } });
		fireEvent.click(screen.getByRole("button", { name: /save version/i }));
		await waitFor(() => expect(recordFileVersion).toHaveBeenCalledWith("/w", "notes/a.md", "one\nthree\nfour\n", { label: "Before review" }));
	});

	it("shares a named version and says so, crediting the person who named it", async () => {
		const onNamed = vi.fn(() => true);
		open({ authorName: "Ed", onNamed });
		await screen.findByText("four");
		fireEvent.change(screen.getByLabelText("Version name"), { target: { value: "Agreed" } });
		fireEvent.click(screen.getByRole("button", { name: /save version/i }));
		await waitFor(() => expect(recordFileVersion).toHaveBeenCalledWith("/w", "notes/a.md", "one\nthree\nfour\n", { label: "Agreed", author: "Ed" }));
		expect(onNamed).toHaveBeenCalledWith("Agreed", "one\nthree\nfour\n");
		expect(await screen.findByText(/shared with collaborators/i)).toBeTruthy();
	});

	it("says when a named version was too large to share", async () => {
		open({ onNamed: () => false });
		await screen.findByText("four");
		fireEvent.change(screen.getByLabelText("Version name"), { target: { value: "Big" } });
		fireEvent.click(screen.getByRole("button", { name: /save version/i }));
		expect(await screen.findByText(/too large to share/i)).toBeTruthy();
	});

	it("shows who named a version", async () => {
		vi.mocked(listFileVersions).mockResolvedValue([version(2, { source: "named", label: "Agreed draft", author: "Ann" }), version(1)]);
		open();
		expect(await screen.findByText("by Ann")).toBeTruthy();
		expect(screen.getByText("Agreed draft")).toBeTruthy();
	});

	it("restores an attachment only after a confirmation", async () => {
		vi.mocked(listFileVersions).mockResolvedValue([version(3, { path: "assets/pic.png" })]);
		const onRestored = vi.fn();
		open({ path: "assets/pic.png", currentText: undefined, onRestored });
		fireEvent.click(await screen.findByRole("button", { name: /restore this version/i }));
		expect(restoreFileVersion).not.toHaveBeenCalled();
		fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
		await waitFor(() => expect(restoreFileVersion).toHaveBeenCalledWith("/w", 3));
		await waitFor(() => expect(onRestored).toHaveBeenCalled());
		expect(readFileVersion).not.toHaveBeenCalled();
	});

	it("does not offer restore to a viewer", async () => {
		open({ readOnly: true, onRestoreText: vi.fn() });
		await screen.findByText("four");
		expect((screen.getByRole("button", { name: /restore this version/i }) as HTMLButtonElement).disabled).toBe(true);
		expect(screen.queryByLabelText("Version name")).toBeNull();
	});

	it("explains an empty history", async () => {
		vi.mocked(listFileVersions).mockResolvedValue([]);
		open();
		expect(await screen.findByText(/no versions yet/i)).toBeTruthy();
	});
});
