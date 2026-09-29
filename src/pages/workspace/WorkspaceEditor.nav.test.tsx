import { fireEvent, render, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/core", () => ({
	invoke: async (command: string) => {
		if (command === "read_workspace_file") return "print(1)\n";
		if (command.startsWith("list_") || command === "p2p_list_peers") return [];
		return null;
	},
}));
vi.mock("@/store/workspace/WorkspaceContext", () => ({
	subscribeToActivityEvents: () => () => {},
	useWorkspace: () => ({
		workspace: { path: "/w", id: "1", name: "W" },
		metadata: null,
		refreshMetadata: async () => {},
		refreshStats: async () => {},
		addActivityEvent: () => {},
	}),
}));
vi.mock("@/store/ThemeContext", () => ({ useThemeContext: () => ({ isDark: true }) }));

import { P2PProvider } from "@/store/p2p/P2PContext";
import WorkspaceEditor from "./WorkspaceEditor";

// Regression: with a file open, the editor kept re-rendering itself, so the sidebar links did nothing
describe("leaving the Editor page", () => {
	it("navigates away while a file is open", async () => {
		const { findByText, getByText } = render(
			<MemoryRouter initialEntries={["/editor?open=%2Feditor%2Fmain.py"]}>
				<P2PProvider>
					<Link to="/notes">go</Link>
					<Routes>
						<Route path="/editor" element={<WorkspaceEditor />} />
						<Route path="/notes" element={<p>notes page</p>} />
					</Routes>
				</P2PProvider>
			</MemoryRouter>,
		);
		await findByText("main.py");
		await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull());
		fireEvent.click(getByText("go"));
		await findByText("notes page");
	});
});
