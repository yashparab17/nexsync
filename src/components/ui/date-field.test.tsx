import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DateField } from "./date-field";

afterEach(cleanup);

describe("DateField", () => {
	it("shows the date it is given and clears it", () => {
		const onChange = vi.fn();
		render(<DateField value="2026-03-04" onChange={onChange} />);
		expect(screen.getAllByRole("spinbutton").map((s) => s.textContent).join("")).toContain("2026");
		fireEvent.click(screen.getByRole("button", { name: "Clear date" }));
		expect(onChange).toHaveBeenCalledWith("");
	});

	it("has nothing to clear when empty, and opens a calendar", () => {
		render(<DateField value="" onChange={() => {}} />);
		expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /calendar/i }));
		expect(screen.getByRole("grid")).toBeTruthy();
	});
});
