import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("@/lib/tauri", () => ({
	searchWorkspaceFiles: vi.fn(async () => []),
	getTasks: vi.fn(async () => [
		{ id: "t1", title: "Write report", description: "", status: "todo", priority: "low", tags: [], created_at: "t", updated_at: "t" },
	]),
	getKanban: vi.fn(async () => []),
}));
vi.mock("@/store/workspace/WorkspaceContext", () => ({
	useWorkspace: () => ({ workspace: { id: "ws1", path: "/w", name: "W" } }),
}));

import WorkspaceSearch from "./WorkspaceSearch";

function Where() {
	const location = useLocation();
	return <output data-testid="where">{location.pathname + location.search}</output>;
}
const open = () =>
	render(
		<MemoryRouter>
			<WorkspaceSearch />
			<Where />
		</MemoryRouter>,
	);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("workspace search and command palette", () => {
	it("Ctrl+K puts the cursor in the search box", () => {
		open();
		fireEvent.keyDown(window, { key: "k", ctrlKey: true });
		expect(document.activeElement).toBe(screen.getByLabelText("Search workspace"));
	});

	it("jumps to a page by name", () => {
		open();
		const box = screen.getByLabelText("Search workspace");
		fireEvent.focus(box);
		fireEvent.change(box, { target: { value: "kanban" } });
		fireEvent.click(screen.getByText("Kanban board"));
		expect(screen.getByTestId("where").textContent).toBe("/workspace/kanban");
	});

	it("filters results by type", async () => {
		open();
		const box = screen.getByLabelText("Search workspace");
		fireEvent.focus(box);
		fireEvent.change(box, { target: { value: "t" } });
		await screen.findByText("Write report");
		expect(screen.getByText("Tasks")).toBeTruthy(); // the page
		fireEvent.click(screen.getByRole("button", { name: "Task" }));
		expect(screen.getByText("Write report")).toBeTruthy();
		expect(screen.queryByText("Open page")).toBeNull();
	});

	it("lists what was opened last when the box is empty", async () => {
		open();
		const box = screen.getByLabelText("Search workspace");
		fireEvent.focus(box);
		fireEvent.change(box, { target: { value: "trash" } });
		fireEvent.click(screen.getByText("Trash"));
		fireEvent.blur(box);
		fireEvent.change(box, { target: { value: "" } });
		fireEvent.focus(box);
		await waitFor(() => expect(screen.getByText("Recent")).toBeTruthy());
		expect(screen.getByText("Trash")).toBeTruthy();
	});
});
