import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const files: Record<string, string> = {
	"notes/Plan.md": "# Plan\nSee [[Budget]].",
	"notes/Budget.md": "Costs. Back to [[plan]].",
	"notes/Ideas.md": "Nothing linked.",
};
vi.mock("@/lib/tauri", () => ({ readWorkspaceFile: vi.fn(async (_root: string, rel: string) => files[rel] ?? "") }));

import NoteSidePanel from "./NoteSidePanel";

afterEach(cleanup);

const notes = [
	{ path: "/notes/Plan.md", name: "Plan.md" },
	{ path: "/notes/Budget.md", name: "Budget.md" },
	{ path: "/notes/Ideas.md", name: "Ideas.md" },
];

const open = (text: string, handlers = { onOpenNote: vi.fn(), onGoToLine: vi.fn() }) => {
	render(<NoteSidePanel workspacePath="/w" current={notes[0]} notes={notes} text={text} {...handlers} />);
	return handlers;
};

describe("NoteSidePanel", () => {
	it("lists headings and jumps to their line", () => {
		const { onGoToLine } = open("intro\n## Costs\n### Detail");
		fireEvent.click(screen.getByRole("button", { name: "Detail" }));
		expect(onGoToLine).toHaveBeenCalledWith(3);
		expect(screen.getByRole("button", { name: "Costs" })).toBeTruthy();
	});

	it("opens a linked note, and marks a link to a note that does not exist", () => {
		const { onOpenNote } = open("[[budget]] and [[Nowhere]]");
		fireEvent.click(screen.getByRole("button", { name: "budget" }));
		expect(onOpenNote).toHaveBeenCalledWith("/notes/Budget.md");
		expect(screen.getByText(/no such note/i)).toBeTruthy();
	});

	it("lists the notes that link here and opens one", async () => {
		const { onOpenNote } = open("");
		fireEvent.click(await screen.findByRole("button", { name: "Budget.md" }));
		expect(onOpenNote).toHaveBeenCalledWith("/notes/Budget.md");
		expect(screen.queryByRole("button", { name: "Ideas.md" })).toBeNull();
	});

	it("explains each empty section", () => {
		open("plain text");
		expect(screen.getByText(/headings you write/i)).toBeTruthy();
		expect(screen.getByText(/write \[\[note name\]\]/i)).toBeTruthy();
	});
});
