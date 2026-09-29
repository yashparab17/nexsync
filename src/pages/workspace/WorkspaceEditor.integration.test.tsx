import { StrictMode } from "react";
import * as Y from "yjs";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// Only the bridge to Rust is faked; the P2P provider, collaboration hook and editor are the real ones.
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
// What the local database holds for the open file's shared text, as base64; null when nothing is stored
const store: { shared: string | null } = { shared: null };

vi.mock("@tauri-apps/api/core", () => ({
	invoke: async (command: string) => {
		switch (command) {
			case "get_yjs_doc":
				return store.shared;
			case "read_workspace_file":
				return "const a = 1;\n";
			case "list_workspace_files":
			case "list_yjs_docs":
			case "p2p_list_peers":
				return [];
			default:
				return null;
		}
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

import TransferTray from "@/components/layout/workspace/TransferTray";
import { P2PProvider } from "@/store/p2p/P2PContext";
import WorkspaceEditor from "./WorkspaceEditor";

describe("Editor page with the real P2P provider", () => {
	it("shows the saved text when a file is reopened", async () => {
		// The shared text was stored earlier, so it is ready before the editor exists, as on a second visit
		const earlier = new Y.Doc();
		earlier.getText("content").insert(0, "<h1>Saved earlier</h1>\n");
		store.shared = btoa(String.fromCharCode(...Y.encodeStateAsUpdate(earlier)));

		const { unmount } = render(
			<MemoryRouter initialEntries={["/editor?open=%2Feditor%2Fpage.html"]}>
				<P2PProvider>
					<WorkspaceEditor />
				</P2PProvider>
			</MemoryRouter>,
		);
		await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("Saved earlier"));
		unmount();
		store.shared = null;
	});

	it("opens a file, then unmounts everything without a crash", async () => {
		const { unmount, findByText } = render(
			<StrictMode>
				<MemoryRouter initialEntries={["/editor?open=%2Feditor%2Fa.js"]}>
					<P2PProvider>
						<TransferTray />
						<WorkspaceEditor />
					</P2PProvider>
				</MemoryRouter>
			</StrictMode>,
		);
		await findByText("a.js");
		await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull());
		expect(() => unmount()).not.toThrow();
	});
});
