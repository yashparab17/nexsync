import { StrictMode } from "react";
import { render, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/store/ThemeContext", () => ({ useThemeContext: () => ({ isDark: true }) }));
vi.mock("@/store/workspace/WorkspaceContext", () => ({
	useWorkspace: () => ({ workspace: { path: "/w", id: "1", name: "W" }, metadata: null }),
}));

import BlockNoteEditor from "./BlockNoteEditor";

// jsdom has no matchMedia, which Mantine reads for the color scheme
window.matchMedia ??= ((media: string) => ({
	matches: false,
	media,
	onchange: null,
	addListener: () => {},
	removeListener: () => {},
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

describe("Rich text note editor", () => {
	for (const collaborating of [false, true]) {
		it(`mounts and unmounts without a crash (${collaborating ? "live" : "local"})`, async () => {
			const doc = new Y.Doc();
			const collab = collaborating ? { doc, awareness: new Awareness(doc), synced: true } : null;
			const { unmount } = render(
				<StrictMode>
					<BlockNoteEditor
						initialMarkdown={"# Title\n\n```js\nconst a = 1;\n```\n"}
						onChange={() => {}}
						collab={collab}
						userName="Me"
					/>
				</StrictMode>,
			);
			await waitFor(() => expect(document.querySelector(".bn-editor")).not.toBeNull());
			expect(() => unmount()).not.toThrow();
		});
	}
});
