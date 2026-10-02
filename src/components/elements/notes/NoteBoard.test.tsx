import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import NoteBoard from "./NoteBoard";
import NoteGraph from "./NoteGraph";
import { buildEdges } from "@/lib/notes/graph";

afterEach(cleanup);

const notes = [
	{ path: "/notes/Plan.txt", name: "Plan.txt", text: "# Goals\n## Next steps\nSee [[Ideas]] for more" },
	{ path: "/notes/Ideas.txt", name: "Ideas.txt", text: "just some words" },
];
const edges = buildEdges(notes);
const positions = { "/notes/Plan.txt": { x: 10, y: 10 }, "/notes/Ideas.txt": { x: 400, y: 10 } };

describe("NoteBoard", () => {
	it("shows each note as a card with its headings and opens it on double-click", () => {
		const onOpen = vi.fn();
		render(<NoteBoard notes={notes} positions={positions} edges={edges} activePath={null} onMove={() => {}} onOpen={onOpen} userName="Sam" />);
		const card = screen.getByRole("button", { name: "Note Plan" });
		expect(card.textContent).toContain("Goals");
		expect(card.textContent).toContain("Next steps");
		expect(card.textContent).toContain("1 link");
		fireEvent.doubleClick(card);
		expect(onOpen).toHaveBeenCalledWith("/notes/Plan.txt");
	});

	it("does not offer delete to a reader", () => {
		render(<NoteBoard notes={notes} positions={positions} edges={edges} activePath={null} onMove={() => {}} onOpen={() => {}} onDelete={() => {}} userName="Sam" readOnly />);
		expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
	});
});

describe("NoteGraph", () => {
	it("draws a dot for each note and opens one when it is clicked", () => {
		const onOpen = vi.fn();
		render(<NoteGraph notes={notes} edges={edges} activePath={null} onOpen={onOpen} />);
		fireEvent.click(screen.getByRole("button", { name: "Open Ideas" }));
		expect(onOpen).toHaveBeenCalledWith("/notes/Ideas.txt");
		expect(screen.getByRole("button", { name: "Open Plan" })).toBeTruthy();
	});

	it("says how to make links when there are none", () => {
		render(<NoteGraph notes={notes} edges={[]} activePath={null} onOpen={() => {}} />);
		expect(screen.getByText(/No links yet/)).toBeTruthy();
	});
});
