import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import ConflictPanel from "./ConflictPanel";
import type { Conflict } from "@/types/workspace";

afterEach(cleanup);

const conflicts: Conflict[] = [
	{ field: "title", options: [{ value: "Title B", ts: 2000, who: "Bo" }, { value: "Title A", ts: 1000, who: "Ana" }] },
	{ field: "assignee_id", options: [{ value: "m2", ts: 3000 }, { value: null, ts: 2500 }] },
];
const show = (field: string, value: unknown) => (field === "assignee_id" && value === "m2" ? "Raven" : value === null ? "" : String(value));

describe("conflict panel", () => {
	it("shows every value that was written, who wrote it, and which one is shown now", () => {
		render(<ConflictPanel conflicts={conflicts} show={show} canChoose onChoose={() => {}} />);
		expect(screen.getByText("Title B")).toBeTruthy();
		expect(screen.getByText("Title A")).toBeTruthy();
		expect(screen.getByText("Raven")).toBeTruthy();
		expect(screen.getByText("(empty)")).toBeTruthy();
		expect(screen.getByText(/Bo, .*shown now/)).toBeTruthy();
		expect(screen.getByText("Assigned to")).toBeTruthy();
	});

	it("hands back the field and the value that was chosen", () => {
		const onChoose = vi.fn();
		render(<ConflictPanel conflicts={conflicts} show={show} canChoose onChoose={onChoose} />);
		fireEvent.click(screen.getAllByRole("button", { name: "Keep this" })[1]);
		expect(onChoose).toHaveBeenCalledWith("title", "Title A");
	});

	it("lets a viewer see the conflict but not settle it, and shows nothing when there is none", () => {
		const { container, rerender } = render(<ConflictPanel conflicts={conflicts} show={show} canChoose={false} onChoose={() => {}} />);
		expect(screen.queryByRole("button", { name: "Keep this" })).toBeNull();
		rerender(<ConflictPanel conflicts={[]} show={show} canChoose onChoose={() => {}} />);
		expect(container.textContent).toBe("");
	});
});
