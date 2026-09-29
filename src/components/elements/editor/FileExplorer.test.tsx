import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { WorkspaceFile } from "@/types/workspace";
import FileExplorer from "./FileExplorer";

const entry = (path: string, is_dir = false): WorkspaceFile => ({
	name: path.split("/").pop()!,
	path: `/${path}`,
	is_dir,
	size: 0,
	modified_at: "",
});

const entries = {
	editor: [entry("editor/src", true), entry("editor/main.py")],
	"editor/src": [entry("editor/src/app.py"), entry("editor/src/notes.txt")],
	files: [],
};

const setup = (over: Partial<React.ComponentProps<typeof FileExplorer>> = {}) => {
	const props = {
		roots: ["editor", "files"],
		entries,
		expanded: new Set(["editor", "editor/src"]),
		targetDir: "editor/src",
		activePath: "editor/main.py",
		openPaths: ["editor/main.py"],
		dirtyPaths: new Set<string>(),
		readOnly: false,
		onToggleDir: vi.fn(),
		onOpenFile: vi.fn(),
		onNew: vi.fn(),
		onRename: vi.fn(),
		onDelete: vi.fn(),
		onRefresh: vi.fn(),
		onCollapseAll: vi.fn(),
		onFilterStart: vi.fn(),
		...over,
	};
	render(<FileExplorer {...props} />);
	return props;
};

afterEach(cleanup);

describe("FileExplorer", () => {
	it("says where a new file will go, and creates it there", () => {
		const props = setup();
		expect(screen.getByText("editor/src", { selector: "span.font-mono" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "New file" }));
		expect(props.onNew).toHaveBeenCalledWith("file", "editor/src");
	});

	it("offers actions on a folder and renames a file", () => {
		const props = setup();
		fireEvent.click(screen.getByRole("button", { name: "New folder in src" }));
		expect(props.onNew).toHaveBeenCalledWith("folder", "editor/src");
		fireEvent.click(screen.getByRole("button", { name: "Rename app.py" }));
		expect(props.onRename).toHaveBeenCalledWith(entries["editor/src"][0]);
	});

	it("filters files in folders and hides the rest", () => {
		const props = setup({ expanded: new Set() });
		fireEvent.change(screen.getByLabelText("Filter files"), { target: { value: "notes" } });
		expect(props.onFilterStart).toHaveBeenCalled();
		expect(screen.getByText("notes.txt")).toBeTruthy();
		expect(screen.queryByText("main.py")).toBeNull();
		fireEvent.change(screen.getByLabelText("Filter files"), { target: { value: "zzz" } });
		expect(screen.getByText(/No files match/)).toBeTruthy();
	});

	it("uses the keyboard: F2 renames, Delete deletes, arrows fold folders", () => {
		const props = setup();
		const row = screen.getByTitle("editor/main.py");
		fireEvent.keyDown(row, { key: "F2" });
		fireEvent.keyDown(row, { key: "Delete" });
		expect(props.onRename).toHaveBeenCalledTimes(1);
		expect(props.onDelete).toHaveBeenCalledTimes(1);
		fireEvent.keyDown(screen.getByTitle("editor/src"), { key: "ArrowLeft" });
		expect(props.onToggleDir).toHaveBeenCalledWith("editor/src");
	});

	it("shows no change controls to a viewer", () => {
		setup({ readOnly: true });
		expect(screen.queryByRole("button", { name: "New file" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Rename main.py" })).toBeNull();
		expect(screen.getByRole("button", { name: "Refresh files" })).toBeTruthy();
	});
});
