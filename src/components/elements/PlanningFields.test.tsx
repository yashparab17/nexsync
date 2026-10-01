import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { ChecklistItem, Task } from "@/types/workspace";
import { ChecklistEditor, DueBadge, TagInput } from "./PlanningFields";
import TaskCalendar from "./TaskCalendar";

afterEach(cleanup);

function Tags({ initial = [] as string[] }) {
	const [tags, setTags] = useState(initial);
	return (
		<>
			<TagInput id="t" value={tags} onChange={setTags} />
			<output data-testid="tags">{tags.join("|")}</output>
		</>
	);
}

describe("TagInput", () => {
	it("adds a tag on Enter and on a comma, and removes one with its button", () => {
		render(<Tags />);
		const box = screen.getByPlaceholderText(/add a tag/i);
		fireEvent.change(box, { target: { value: "Urgent" } });
		fireEvent.keyDown(box, { key: "Enter" });
		fireEvent.change(box, { target: { value: "api, ui" } });
		expect(screen.getByTestId("tags").textContent).toBe("urgent|api|ui");
		fireEvent.click(screen.getByRole("button", { name: "Remove tag api" }));
		expect(screen.getByTestId("tags").textContent).toBe("urgent|ui");
	});

	it("removes the last tag with Backspace on an empty box", () => {
		render(<Tags initial={["a", "b"]} />);
		fireEvent.keyDown(screen.getByRole("combobox"), { key: "Backspace" });
		expect(screen.getByTestId("tags").textContent).toBe("a");
	});
});

function Checklist() {
	const [items, setItems] = useState<ChecklistItem[]>([]);
	return (
		<>
			<ChecklistEditor value={items} onChange={setItems} />
			<output data-testid="items">{items.map((i) => `${i.done ? "x" : "-"}${i.text}`).join("|")}</output>
		</>
	);
}

describe("ChecklistEditor", () => {
	it("adds, ticks and removes items", () => {
		render(<Checklist />);
		const box = screen.getByLabelText("New checklist item");
		fireEvent.change(box, { target: { value: "write tests" } });
		fireEvent.keyDown(box, { key: "Enter" });
		fireEvent.change(box, { target: { value: "ship" } });
		fireEvent.click(screen.getByRole("button", { name: "Add checklist item" }));
		expect(screen.getByTestId("items").textContent).toBe("-write tests|-ship");
		fireEvent.click(screen.getByLabelText("Done: write tests"));
		expect(screen.getByTestId("items").textContent).toBe("xwrite tests|-ship");
		fireEvent.click(screen.getByRole("button", { name: "Remove ship" }));
		expect(screen.getByTestId("items").textContent).toBe("xwrite tests");
	});
});

describe("DueBadge", () => {
	it("shows nothing without a date and flags a past date as overdue", () => {
		const { container } = render(<DueBadge due={undefined} done={false} />);
		expect(container.textContent).toBe("");
		render(<DueBadge due="2000-01-01" done={false} />);
		expect(screen.getByText(/overdue/i)).toBeTruthy();
	});

	it("does not call finished work overdue", () => {
		render(<DueBadge due="2000-01-01" done />);
		expect(screen.queryByText(/overdue/i)).toBeNull();
	});
});

const task = (id: string, title: string, due?: string): Task => ({
	id,
	title,
	description: "",
	status: "todo",
	priority: "medium",
	due_date: due,
	tags: [],
	created_at: "t",
	updated_at: "t",
});

describe("TaskCalendar", () => {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-15`;
	const next = new Date(now.getFullYear(), now.getMonth() + 1, 15);
	const nextMonth = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-15`;

	it("places a task on its due day and opens it when clicked", () => {
		const onOpen = vi.fn();
		const tasks = [task("1", "Ship it", thisMonth), task("2", "Later", nextMonth), task("3", "No date")];
		render(<TaskCalendar tasks={tasks} onOpen={onOpen} />);
		expect(screen.queryByText("Later")).toBeNull();
		expect(screen.getByText(/1 task without a due date/i)).toBeTruthy();
		fireEvent.click(screen.getByText("Ship it"));
		expect(onOpen).toHaveBeenCalledWith(tasks[0]);
	});

	it("moves to the next month", () => {
		render(<TaskCalendar tasks={[task("2", "Later", nextMonth)]} onOpen={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "Next month" }));
		expect(screen.getByText("Later")).toBeTruthy();
	});
});
