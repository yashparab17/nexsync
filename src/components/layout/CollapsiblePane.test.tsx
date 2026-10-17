import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { setCollapsed } from "@/hooks/useCollapsed";
import CollapsiblePane from "@/components/layout/CollapsiblePane";

afterEach(() => {
	cleanup();
	localStorage.clear();
});

const pane = () => (
	<CollapsiblePane id="test.list" label="the list" defaultWidth={200}>
		<nav aria-label="List">items</nav>
	</CollapsiblePane>
);

describe("CollapsiblePane", () => {
	it("has no button while open, folds when its edge is dragged narrow, and opens again from the edge or the button", () => {
		render(pane());
		expect(screen.queryByRole("button")).toBeNull();
		const edge = screen.getByRole("separator", { name: "Resize the list" });
		expect(edge.getAttribute("aria-valuenow")).toBe("200");
		// Arrow keys change the width a step at a time; far enough narrow and it folds
		fireEvent.keyDown(edge, { key: "ArrowRight" });
		expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("216");
		for (let i = 0; i < 6; i++) fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft", shiftKey: true });
		expect(screen.queryByRole("navigation", { name: "List" })).toBeNull();
		expect(localStorage.getItem("nexsync.fold.test.list")).toBe("1");
		fireEvent.click(screen.getByRole("button", { name: "Show the list" }));
		expect(screen.getByRole("navigation", { name: "List" })).toBeTruthy();
	});

	it("stays folded after a restart", () => {
		setCollapsed("test.list", true);
		render(pane());
		expect(screen.queryByRole("navigation", { name: "List" })).toBeNull();
		expect(screen.getByRole("button", { name: "Show the list" })).toBeTruthy();
	});
});
