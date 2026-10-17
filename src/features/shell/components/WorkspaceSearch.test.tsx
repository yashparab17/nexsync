import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("@/lib/tauri", () => ({
	searchWorkspaceFiles: vi.fn(async () => []),
	getTasks: vi.fn(async () => [
		{ id: "t1", title: "Write report", description: "", status: "todo", priority: "low", tags: [], created_at: "t", updated_at: "t" },
	]),
	getKanban: vi.fn(async () => []),
	projectsList: vi.fn(async () => [
		{ id: "web", path: "projects/web", name: "web", scratch: false, recipe: null, recipeError: null, detected: { kinds: [], packageManager: null, tasks: [{ id: "dev", label: "Start the Dev Server", command: "npm run dev" }], tools: [], env: [] } },
	]),
}));
vi.mock("@/store/workspace/WorkspaceContext", () => ({
	useWorkspace: () => ({ workspace: { id: "ws1", path: "/w", name: "W" } }),
}));

import WorkspaceSearch from "@/features/shell/components/WorkspaceSearch";

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
		fireEvent.click(screen.getByRole("option", { name: /Kanban board/ }));
		expect(screen.getByTestId("where").textContent).toBe("/workspace/kanban");
	});

	it("offers each project's tasks and opens Projects to start the one chosen", async () => {
		open();
		const box = screen.getByLabelText("Search workspace");
		fireEvent.focus(box);
		fireEvent.change(box, { target: { value: "dev server" } });
		fireEvent.click(await screen.findByRole("option", { name: /Run Start the Dev Server in web/ }));
		expect(screen.getByTestId("where").textContent).toBe("/workspace/projects?run=web%3Adev");
	});

	it("filters results by type", async () => {
		open();
		const box = screen.getByLabelText("Search workspace");
		fireEvent.focus(box);
		fireEvent.change(box, { target: { value: "t" } });
		await screen.findByRole("option", { name: /Write report/ });
		expect(screen.getByRole("option", { name: /Tasks/ })).toBeTruthy(); // the page
		fireEvent.click(screen.getByRole("button", { name: "Task" }));
		expect(screen.getByRole("option", { name: /Write report/ })).toBeTruthy();
		expect(screen.queryByText("Open page")).toBeNull();
	});

	it("lists what was opened last when the box is empty", async () => {
		open();
		const box = screen.getByLabelText("Search workspace");
		fireEvent.focus(box);
		fireEvent.change(box, { target: { value: "trash" } });
		fireEvent.click(screen.getByRole("option", { name: /Trash/ }));
		fireEvent.blur(box);
		fireEvent.change(box, { target: { value: "" } });
		fireEvent.focus(box);
		await waitFor(() => expect(screen.getByText("Recent")).toBeTruthy());
		expect(screen.getByRole("option", { name: /Trash/ })).toBeTruthy();
	});
});
