import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The emulator needs a real browser; the panel's own behaviour is what is tested here
vi.mock("./TerminalView", () => ({ default: () => <div data-testid="terminal" /> }));

import TerminalPanel from "./TerminalPanel";

afterEach(cleanup);

describe("TerminalPanel", () => {
	it("starts no shell until it is shown, then one", () => {
		const { rerender } = render(<TerminalPanel workspacePath="/w" dir="editor" visible={false} />);
		expect(screen.queryAllByRole("tab")).toHaveLength(0);
		rerender(<TerminalPanel workspacePath="/w" dir="editor" visible />);
		expect(screen.getAllByRole("tab")).toHaveLength(1);
	});

	it("adds and kills terminals", () => {
		render(<TerminalPanel workspacePath="/w" dir="editor" visible />);
		fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
		expect(screen.getAllByRole("tab")).toHaveLength(2);
		fireEvent.click(screen.getByRole("button", { name: "Kill Terminal 2" }));
		expect(screen.getAllByRole("tab")).toHaveLength(1);
		expect(screen.getByRole("tab", { name: "Terminal 1" }).getAttribute("aria-selected")).toBe("true");
	});
});
