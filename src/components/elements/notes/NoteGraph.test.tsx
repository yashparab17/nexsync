import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import NoteGraph from "@/components/elements/notes/NoteGraph";

afterEach(cleanup);
const notes = [
	{ path: "notes/a.md", name: "a.md", text: "[[b]]" },
	{ path: "notes/b.md", name: "b.md", text: "" },
];
const edges = [{ from: "notes/a.md", to: "notes/b.md" }];

describe("note graph", () => {
	it("moves a note when it is dragged, without opening it", () => {
		const onOpen = vi.fn();
		const { container } = render(<NoteGraph notes={notes} edges={edges} activePath={null} onOpen={onOpen} />);
		const node = screen.getByRole("button", { name: "Open a" });
		const svg = container.querySelector("svg")!;
		const before = node.getAttribute("transform");
		fireEvent.pointerDown(node, { clientX: 100, clientY: 100 });
		fireEvent.pointerMove(svg, { clientX: 220, clientY: 180 });
		fireEvent.pointerUp(svg);
		fireEvent.click(node);
		expect(screen.getByRole("button", { name: "Open a" }).getAttribute("transform")).not.toBe(before);
		expect(onOpen).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Open b" }));
		expect(onOpen).toHaveBeenCalledWith("notes/b.md");
	});
});
