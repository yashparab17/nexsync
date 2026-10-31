import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChangesDialog from "@/features/office/documents/components/ChangesDialog";
import type { Change } from "@/features/office/documents/lib/documentReview";

afterEach(cleanup);

const change = (kind: Change["kind"], from: number, author: string, text: string): Change => ({ kind, from, to: from + text.length, author, date: "2026-10-31T10:00:00.000Z", text, values: [`${author}|x`] });
const list = [change("insertion", 1, "Ana", "new words"), change("deletion", 20, "Sam", "old words"), change("insertion", 40, "Ana", "more")];

describe("the list of tracked changes", () => {
	it("lists every change with who made it, and narrows to one person", () => {
		render(<ChangesDialog changes={list} readOnly={false} onGo={() => {}} onResolve={() => {}} onClose={() => {}} />);
		expect(screen.getByText("new words")).toBeTruthy();
		expect(screen.getByText("old words")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Show"), { target: { value: "Sam" } });
		expect(screen.queryByText("new words")).toBeNull();
		expect(screen.getByText("old words")).toBeTruthy();
	});

	it("goes to, accepts and rejects one change, and a viewer can only look", () => {
		const onGo = vi.fn();
		const onResolve = vi.fn();
		const { rerender } = render(<ChangesDialog changes={list} readOnly={false} onGo={onGo} onResolve={onResolve} onClose={() => {}} />);
		fireEvent.click(screen.getAllByRole("button", { name: "Accept" })[1]);
		expect(onResolve).toHaveBeenCalledWith(list[1], true);
		fireEvent.click(screen.getAllByRole("button", { name: "Reject" })[0]);
		expect(onResolve).toHaveBeenCalledWith(list[0], false);
		fireEvent.click(screen.getAllByRole("button", { name: "Go There" })[2]);
		expect(onGo).toHaveBeenCalledWith(list[2]);
		rerender(<ChangesDialog changes={list} readOnly onGo={onGo} onResolve={onResolve} onClose={() => {}} />);
		expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
	});

	it("says so when there are none", () => {
		render(<ChangesDialog changes={[]} readOnly={false} onGo={() => {}} onResolve={() => {}} onClose={() => {}} />);
		expect(screen.getByText("No tracked changes.")).toBeTruthy();
	});
});
