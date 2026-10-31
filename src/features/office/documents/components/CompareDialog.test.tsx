import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const officeFileLines = vi.fn(async (_p: string, _rel: string) => ["Shared line", "Only in the other"]);
vi.mock("@/lib/tauri", () => ({
	listFileVersions: async () => [],
	officeVersionLines: async () => [],
	officeFileLines: (p: string, rel: string) => officeFileLines(p, rel),
}));

import CompareDialog from "@/features/office/documents/components/CompareDialog";

afterEach(cleanup);

describe("comparing with another document", () => {
	it("offers the other documents, reads the one chosen and shows what differs", async () => {
		render(<CompareDialog workspacePath="/ws" rel="office/documents/A.docx" others={[{ name: "B.docx", rel: "/office/documents/B.docx" }]} lines={() => ["Shared line", "Only in this one"]} onClose={() => {}} />);
		fireEvent.click(screen.getByLabelText("Another document"));
		fireEvent.click(screen.getByRole("button", { name: "Compare" }));
		await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
		expect(officeFileLines).toHaveBeenCalledWith("/ws", "office/documents/B.docx");
		expect(screen.getByRole("status").textContent).toMatch(/insertion/);
		// The words only this document has are marked as added, and the other's as deleted
		const all = (tag: string) => Array.from(document.body.querySelectorAll(tag)).map((n) => n.textContent).join(" ");
		expect(all("ins")).toContain("this");
		expect(all("del")).toContain("other");
	});

	it("has no choice to make when there is no other document", () => {
		render(<CompareDialog workspacePath="/ws" rel="a.docx" others={[]} lines={() => []} onClose={() => {}} />);
		expect(screen.queryByLabelText("Another document")).toBeNull();
	});
});
