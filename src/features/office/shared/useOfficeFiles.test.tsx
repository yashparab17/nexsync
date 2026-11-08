import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addActivityEvent = vi.fn();
const logError = vi.fn();
let viewer = false;

vi.mock("@/lib/tauri", () => ({
	searchWorkspaceFiles: vi.fn(),
	writeWorkspaceBinaryFile: vi.fn(),
	deleteWorkspaceItem: vi.fn(),
	renameWorkspaceItem: vi.fn(),
	renameYjsDoc: vi.fn(),
}));
vi.mock("@/store/workspace/WorkspaceContext", () => ({ useWorkspace: () => ({ workspace: { path: "/ws" }, addActivityEvent }) }));
vi.mock("@/store/p2p/P2PContext", () => ({ useIsViewer: () => viewer, useP2P: () => ({ lastSyncedFile: null }) }));
vi.mock("@/hooks/useErrorLog", () => ({ useErrorLog: () => logError }));
vi.mock("@/hooks/usePresence", () => ({ useReportItem: vi.fn() }));
vi.mock("@/lib/recentFiles", () => ({ pushRecent: vi.fn() }));
vi.mock("@/features/assets/lib/uploadScale", () => ({ readFileBase64: vi.fn(async () => "b64") }));

import { deleteWorkspaceItem, renameWorkspaceItem, renameYjsDoc, searchWorkspaceFiles, writeWorkspaceBinaryFile } from "@/lib/tauri";
import { type OfficeKind, useOfficeFiles } from "./useOfficeFiles";

const KIND: OfficeKind = {
	page: "slides",
	folder: "office/slides",
	matches: (n) => n.endsWith(".pptx"),
	ext: "pptx",
	noun: "deck",
	plural: "decks",
	accept: ".pptx",
	empty: "none",
	reject: "Choose a .pptx file.",
};

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const setup = (opts: { manage?: boolean; make?: () => Promise<unknown> } = {}) => renderHook(() => useOfficeFiles({ kind: KIND, make: opts.make ?? (async () => {}), manage: opts.manage }), { wrapper });
const entry = (path: string) => ({ name: path.split("/").pop()!, path }) as never;

beforeEach(() => {
	viewer = false;
	vi.mocked(searchWorkspaceFiles).mockResolvedValue([entry("/office/slides/b.pptx"), entry("/office/slides/a.pptx"), entry("/office/sheets/x.pptx"), entry("/office/slides/n.txt")]);
	vi.mocked(writeWorkspaceBinaryFile).mockResolvedValue(undefined as never);
	vi.mocked(deleteWorkspaceItem).mockResolvedValue(undefined as never);
	vi.mocked(renameWorkspaceItem).mockResolvedValue(undefined as never);
	vi.mocked(renameYjsDoc).mockResolvedValue(undefined as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("useOfficeFiles", () => {
	it("lists only the kind's files inside its folder, sorted", async () => {
		const { result } = setup();
		await waitFor(() => expect(result.current.list).not.toBeNull());
		expect(result.current.list!.map((f) => f.rel)).toEqual(["office/slides/a.pptx", "office/slides/b.pptx"]);
	});

	it("filters by the search text", async () => {
		const { result } = setup();
		await waitFor(() => expect(result.current.list).not.toBeNull());
		act(() => result.current.setQuery("B."));
		expect(result.current.shown.map((f) => f.name)).toEqual(["b.pptx"]);
	});

	it("makes a file, selects it and refuses a name that exists", async () => {
		const make = vi.fn(async () => {});
		const { result } = setup({ make });
		await waitFor(() => expect(result.current.list).not.toBeNull());
		act(() => result.current.setNewName("A"));
		await act(() => result.current.create());
		expect(make).not.toHaveBeenCalled();
		expect(result.current.notice).toEqual({ ok: false, text: "A deck with that name exists." });
		act(() => result.current.setNewName("Fresh"));
		await act(() => result.current.create());
		expect(make).toHaveBeenCalledWith("/ws/office/slides/Fresh.pptx", "Fresh", "blank");
		expect(result.current.selected).toBe("office/slides/Fresh.pptx");
	});

	it("says so when making a file fails", async () => {
		const { result } = setup({ make: async () => Promise.reject("nope") });
		act(() => result.current.setNewName("Fresh"));
		await act(() => result.current.create());
		expect(result.current.notice?.ok).toBe(false);
		expect(result.current.selected).toBeNull();
	});

	it("rejects an added file of another kind and takes one of its own", async () => {
		const { result } = setup();
		await act(() => result.current.addFile(new File(["x"], "pic.png")));
		expect(result.current.notice?.text).toBe("Choose a .pptx file.");
		expect(writeWorkspaceBinaryFile).not.toHaveBeenCalled();
		await act(() => result.current.addFile(new File(["x"], "deck.pptx")));
		expect(writeWorkspaceBinaryFile).toHaveBeenCalledWith("/ws", "office/slides/deck.pptx", "b64");
		expect(result.current.selected).toBe("office/slides/deck.pptx");
	});

	it("renames a file with its shared copy and keeps the extension", async () => {
		const { result } = setup({ manage: true });
		await waitFor(() => expect(result.current.list).not.toBeNull());
		act(() => result.current.setSelected("office/slides/a.pptx"));
		act(() => result.current.startRename(result.current.list![0]));
		act(() => result.current.setRenaming({ ...result.current.renaming!, value: "c" }));
		await act(() => result.current.rename());
		expect(renameWorkspaceItem).toHaveBeenCalledWith("/ws", "office/slides/a.pptx", "c.pptx");
		expect(renameYjsDoc).toHaveBeenCalledWith("/ws", "office/slides/a.pptx", "office/slides/c.pptx");
		expect(result.current.selected).toBe("office/slides/c.pptx");
	});

	it("does not rename onto an existing file", async () => {
		const { result } = setup({ manage: true });
		await waitFor(() => expect(result.current.list).not.toBeNull());
		act(() => result.current.startRename(result.current.list![0]));
		act(() => result.current.setRenaming({ ...result.current.renaming!, value: "b" }));
		await act(() => result.current.rename());
		expect(renameWorkspaceItem).not.toHaveBeenCalled();
		expect(result.current.renaming?.error).toBe("A deck with that name exists.");
	});

	it("deletes the selected file, logs it and clears the selection", async () => {
		const { result } = setup({ manage: true });
		await waitFor(() => expect(result.current.list).not.toBeNull());
		act(() => result.current.setSelected("office/slides/a.pptx"));
		act(() => result.current.setDeleting(result.current.list![0]));
		await act(() => result.current.remove());
		expect(deleteWorkspaceItem).toHaveBeenCalledWith("/ws", "office/slides/a.pptx");
		expect(addActivityEvent).toHaveBeenCalledWith("Deleted deck", "Deleted deck a.pptx", undefined, "file");
		expect(result.current.selected).toBeNull();
	});

	it("leaves rename and delete alone unless the kind manages files, or for a viewer", async () => {
		const plain = setup();
		await waitFor(() => expect(plain.result.current.list).not.toBeNull());
		act(() => plain.result.current.setDeleting(plain.result.current.list![0]));
		await act(() => plain.result.current.remove());
		viewer = true;
		const view = setup({ manage: true });
		await waitFor(() => expect(view.result.current.list).not.toBeNull());
		act(() => view.result.current.setDeleting(view.result.current.list![0]));
		await act(() => view.result.current.remove());
		expect(deleteWorkspaceItem).not.toHaveBeenCalled();
	});
});
