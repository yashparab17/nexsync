import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

// One shared document per note, created on demand; tests can fill it before the note opens
const docs = vi.hoisted(() => new Map<string, { doc: import("yjs").Doc; awareness: unknown; synced: boolean }>());

vi.mock("@/hooks/useCollabDoc", async () => {
	const Y = await import("yjs");
	const { Awareness } = await import("y-protocols/awareness");
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
vi.mock("@/store/p2p/P2PContext", () => ({ useP2P: () => ({ peers: [], selfName: null }) }));
vi.mock("@/store/workspace/WorkspaceContext", () => ({ useWorkspace: () => ({ metadata: null }) }));
vi.mock("@/store/ThemeContext", () => ({ useThemeContext: () => ({ isDark: true }) }));

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

import NoteEditor from "./NoteEditor";

function open(fileName: string, content: string) {
	return render(
		<NoteEditor
			fileName={fileName}
			initialContent={content}
			onSave={async () => {}}
			onClose={() => {}}
			workspacePath="/w"
			docId={`notes/${fileName}`}
		/>,
	);
}

const stats = () => document.querySelector('[aria-label="Note statistics"]')?.textContent ?? "";

describe("Notes", () => {
	it("edits a .md file as Markdown source and counts words without the markup", async () => {
		open("plan.md", "# Title\n\nSome **bold** words here\n");
		await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull());
		expect(document.querySelector(".bn-editor")).toBeNull();
		await waitFor(() => expect(stats()).toContain("3 lines"));
		expect(stats()).toContain("5 words");
	});

	it("counts what the editor holds, not what was last saved to disk", async () => {
		const { Doc } = await import("yjs");
		const { Awareness } = await import("y-protocols/awareness");
		const stored = new Doc();
		stored.getText("content").insert(0, "just two\n");
		docs.set("notes/stored.md", { doc: stored, awareness: new Awareness(stored), synced: true });
		open("stored.md", "the file on disk says many more words than that\n");
		await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("just two"));
		expect(stats()).toContain("2 words");
		expect(stats()).toContain("1 line");
	});

	it("opens a .txt file in the rich-text editor and counts its plain text", async () => {
		open("todo.txt", "first line\nsecond line\n");
		await waitFor(() => expect(document.querySelector(".bn-editor")).not.toBeNull());
		expect(document.querySelector(".cm-editor")).toBeNull();
		await waitFor(() => expect(stats()).toContain("2 lines"));
		expect(stats()).toContain("4 words");
	});

	it("tells its page the whole text as it is written, so a board can follow each keystroke", async () => {
		const seen = vi.fn();
		render(<NoteEditor fileName="live.md" initialContent={"# Title\nbody\n"} onSave={async () => {}} onClose={() => {}} workspacePath="/w" docId="notes/live.md" onTextChange={seen} />);
		await waitFor(() => expect(seen).toHaveBeenCalledWith("# Title\nbody\n"));
		const { doc } = docs.get("notes/live.md")!;
		doc.getText("content").insert(doc.getText("content").length, "more\n");
		await waitFor(() => expect(seen).toHaveBeenLastCalledWith("# Title\nbody\nmore\n"));
	});
});
