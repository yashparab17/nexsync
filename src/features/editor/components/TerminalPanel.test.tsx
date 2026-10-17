import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The emulator needs a real browser; the panel's own behaviour is what is tested here
vi.mock("@/features/editor/components/TerminalView", () => ({ default: () => <div data-testid="terminal" /> }));

vi.mock("@/lib/tauri", () => ({
	listTerminalShells: () => Promise.resolve([{ id: "/bin/bash", name: "bash", path: "/bin/bash" }, { id: "/bin/zsh", name: "zsh", path: "/bin/zsh" }]),
}));

import TerminalPanel from "@/features/editor/components/TerminalPanel";

afterEach(cleanup);

describe("TerminalPanel", () => {
	it("starts no shell until it is shown, then one in the default shell", async () => {
		const { rerender } = render(<TerminalPanel workspacePath="/w" dir="editor" visible={false} />);
		expect(screen.queryAllByRole("tab")).toHaveLength(0);
		rerender(<TerminalPanel workspacePath="/w" dir="editor" visible />);
		expect(await screen.findByRole("tab", { name: "bash" })).toBeTruthy();
	});

	it("adds and kills terminals", async () => {
		render(<TerminalPanel workspacePath="/w" dir="editor" visible />);
		await screen.findByRole("tab", { name: "bash" });
		fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
		expect(screen.getAllByRole("tab")).toHaveLength(2);
		fireEvent.click(screen.getAllByRole("button", { name: "Kill bash" })[1]);
		expect(screen.getAllByRole("tab")).toHaveLength(1);
		expect(screen.getByRole("tab", { name: "bash" }).getAttribute("aria-selected")).toBe("true");
	});
});
