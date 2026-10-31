import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MarkdownPreview from "@/components/elements/MarkdownPreview";

const files: Record<string, string> = { "notes/Other.md": "# Other\n\nInside text", "notes/Loop.md": "![[Other]]" };
vi.mock("@/lib/tauri", () => ({
	readWorkspaceBinaryFile: async (_ws: string, rel: string) => {
		if (rel === "assets/cat.png" || rel === "notes/pics/dog.png") return "QUJD";
		throw new Error("missing");
	},
	readWorkspaceFile: async (_ws: string, rel: string) => files[rel] ?? Promise.reject(new Error("missing")),
}));

afterEach(cleanup);
const notes = [
	{ path: "notes/Other.md", name: "Other.md" },
	{ path: "notes/Loop.md", name: "Loop.md" },
];

describe("markdown embeds", () => {
	it("shows a picture embedded with ![[name]] from the assets folder", async () => {
		const { container } = render(<MarkdownPreview text="![[cat.png|120]]" workspacePath="/w" from="notes/Me.md" notes={notes} />);
		await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,QUJD"));
		expect(container.querySelector("img")?.getAttribute("width")).toBe("120");
	});

	it("loads a picture written as ![](path) beside the note", async () => {
		const { container } = render(<MarkdownPreview text="![dog](pics/dog.png)" workspacePath="/w" from="notes/Me.md" notes={notes} />);
		await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,QUJD"));
	});

	it("shows an embedded note, and says when one is missing", async () => {
		render(<MarkdownPreview text={"![[Other]]\n\n![[Nope.png]]"} workspacePath="/w" from="notes/Me.md" notes={notes} />);
		await waitFor(() => expect(screen.getByText("Inside text")).toBeTruthy());
		await waitFor(() => expect(screen.getByText("Nope.png was not found")).toBeTruthy());
	});
});
