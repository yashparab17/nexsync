import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SectionHeaderDialog from "@/features/office/documents/components/SectionHeaderDialog";
import { NEW_SECTION } from "@/features/office/documents/lib/documentSections";

afterEach(cleanup);

describe("the header and footer of one section", () => {
	it("starts as 'same as before', takes text, and applies it", () => {
		const onApply = vi.fn();
		render(<SectionHeaderDialog spec={NEW_SECTION} onApply={onApply} onClose={() => {}} />);
		fireEvent.change(screen.getByLabelText("Header"), { target: { value: "Chapter 2" } });
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ header: "Chapter 2", footer: null, num: null }));
	});

	it("takes the footer away on Remove and empties back to 'same as before' when the text is cleared", () => {
		const onApply = vi.fn();
		render(<SectionHeaderDialog spec={{ ...NEW_SECTION, header: "Old", footer: "Foot" }} onApply={onApply} onClose={() => {}} />);
		fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]);
		fireEvent.change(screen.getByLabelText("Header"), { target: { value: "" } });
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ header: null, footer: "" }));
	});

	it("sets the first and even page headers and where the page numbers start", () => {
		const onApply = vi.fn();
		render(<SectionHeaderDialog spec={NEW_SECTION} onApply={onApply} onClose={() => {}} />);
		fireEvent.change(screen.getByLabelText("First page header"), { target: { value: "Title page" } });
		fireEvent.change(screen.getByLabelText("Even page header"), { target: { value: "Left" } });
		fireEvent.change(screen.getByLabelText("Page numbers start at"), { target: { value: "5" } });
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ firstHeader: "Title page", evenHeader: "Left", num: 5 }));
	});
});
