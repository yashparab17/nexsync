import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/tauri")>()),
	listWorkspaceFiles: async () => [],
	readWorkspaceFile: async () => "const a = 1;\n",
	writeWorkspaceFile: async () => {},
	getYjsDoc: async () => null,
	saveYjsDoc: async () => {},
	listYjsDocs: async () => [],
	onRunOutput: async () => () => {},
	onRunExit: async () => () => {},
}));

vi.mock("@/store/workspace/WorkspaceContext", () => ({
	useWorkspace: () => ({
		workspace: { path: "/w", id: "1", name: "W" },
		metadata: null,
		refreshStats: async () => {},
		addActivityEvent: () => {},
	}),
}));

vi.mock("@/store/p2p/P2PContext", () => ({
	useIsViewer: () => false,
	useP2P: () => ({
		lastSyncedFile: null,
		selfName: null,
		createSyncProvider: () => ({ destroy: () => {} }),
	}),
}));

vi.mock("@/store/ThemeContext", () => ({ useThemeContext: () => ({ isDark: true }) }));

vi.mock("@/hooks/useCollabDoc", () => {
	// One document per file, as the real hook keeps one for as long as the file is open
	const docs = new Map<string, { doc: Y.Doc; awareness: Awareness; synced: boolean }>();
	return {
		useCollabDoc: (_path: string, docId: string) => {
			if (!docs.has(docId)) {
				const doc = new Y.Doc();
				docs.set(docId, { doc, awareness: new Awareness(doc), synced: true });
			}
			return docs.get(docId);
		},
	};
});

import WorkspaceEditor from "./WorkspaceEditor";

describe("Editor page", () => {
	it("opens a file from the link and unmounts without a crash", async () => {
		const { unmount, findByText } = render(
			<MemoryRouter initialEntries={["/editor?open=%2Feditor%2Fa.js"]}>
				<WorkspaceEditor />
			</MemoryRouter>,
		);
		await findByText("a.js");
		await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull());
		expect(() => unmount()).not.toThrow();
	});
});
