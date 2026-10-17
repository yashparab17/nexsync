import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProofingDialog from "./ProofingDialog";

vi.mock("@/lib/tauri", () => ({
	proofCheck: vi.fn(async (text: string) =>
		text.includes("sentense")
			? [
					{ text: "sentense", kind: "spelling", message: "", suggestions: ["sentence", "sentences"] },
					{ text: "mispelled", kind: "spelling", message: "", suggestions: [] },
				]
			: [],
	),
}));

afterEach(cleanup);

describe("ProofingDialog", () => {
	it("goes through the problems, changes a word with a suggestion and moves on", async () => {
		const replace = vi.fn(() => 2);
		render(<ProofingDialog text="This sentense is mispelled" replace={replace} onClose={() => {}} readOnly={false} />);
		await waitFor(() => expect(screen.getByText("sentense")).toBeTruthy());
		fireEvent.click(screen.getByRole("button", { name: "sentence" }));
		expect(replace).toHaveBeenCalledWith("sentense", "sentence");
		await waitFor(() => expect(screen.getByText("mispelled")).toBeTruthy());
		expect(screen.getByText("No suggestions.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Ignore All" }));
		await waitFor(() => expect(screen.getByRole("status").textContent).toContain("everything"));
	});

	it("says so when there is nothing wrong, and does not change a read-only document", async () => {
		render(<ProofingDialog text="All good here" replace={vi.fn()} onClose={() => {}} readOnly />);
		await waitFor(() => expect(screen.getByRole("status").textContent).toBe("No problems found."));
	});
});
