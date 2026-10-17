import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import SheetGrid, { type Cursor } from "@/features/office/sheets/components/SheetGrid";
import { a1Of, normalise, type Range, type Shown } from "@/features/office/sheets/lib/sheet";

afterEach(cleanup);

beforeAll(() => {
	// jsdom has no layout: give the grid a window to draw into
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as never;
	Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
	Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 300 });
});

// A grid with a little state of its own, the way the page holds it
function Harness({ log, readOnly = false }: { log: { commits: [string, string][]; clears: Range[]; pastes: [Cursor, string[][]][] }; readOnly?: boolean }) {
	const [cells, setCells] = useState<Record<string, string>>({ A1: "hello", B1: "12", C1: "=A1" });
	const [active, setActive] = useState<Cursor>({ row: 0, col: 0 });
	const [selection, setSelection] = useState<Range>(normalise({ row: 0, col: 0 }, { row: 0, col: 0 }));
	const shown: Record<string, Shown> = Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, { text: v, kind: /^\d+$/.test(v) ? "number" : "text" }]));
	return (
		<>
			<output data-testid="at">{a1Of(active.row, active.col)}</output>
			<output data-testid="sel">{`${selection.r0},${selection.c0}:${selection.r1},${selection.c1}`}</output>
			<SheetGrid
				rows={100}
				cols={26}
				shown={shown}
				typed={(a1) => cells[a1] ?? ""}
				readOnly={readOnly}
				others={[{ name: "Ben", color: "#d22d64", row: 2, col: 2 }]}
				active={active}
				selection={selection}
				onMove={(a, s) => {
					setActive(a);
					setSelection(s);
				}}
				onCommit={(a1, text) => {
					log.commits.push([a1, text]);
					setCells((c) => ({ ...c, [a1]: text }));
				}}
				onClear={(r) => log.clears.push(r)}
				onPaste={(at, rows) => log.pastes.push([at, rows])}
			/>
		</>
	);
}

const grid = () => screen.getByRole("grid");
const fresh = () => ({ commits: [] as [string, string][], clears: [] as Range[], pastes: [] as [Cursor, string[][]][] });

describe("SheetGrid", () => {
	it("draws what the cells show, numbers to the right, and other people's cells with their names", () => {
		render(<Harness log={fresh()} />);
		expect(screen.getByText("hello")).toBeTruthy();
	expect((document.querySelector('[data-r="0"][data-c="1"]') as HTMLElement).style.textAlign).toBe("right");
		expect(screen.getByText("Ben")).toBeTruthy();
		expect(screen.getAllByRole("gridcell").length).toBeGreaterThan(20);
	});

	it("moves with the arrow keys and extends a selection with Shift", () => {
		render(<Harness log={fresh()} />);
		fireEvent.keyDown(grid(), { key: "ArrowDown" });
		fireEvent.keyDown(grid(), { key: "ArrowRight" });
		expect(screen.getByTestId("at").textContent).toBe("B2");
		fireEvent.keyDown(grid(), { key: "ArrowDown", shiftKey: true });
		fireEvent.keyDown(grid(), { key: "ArrowRight", shiftKey: true });
		expect(screen.getByTestId("sel").textContent).toBe("1,1:2,2");
		// Never past the first cell
		fireEvent.keyDown(grid(), { key: "ArrowUp" });
		fireEvent.keyDown(grid(), { key: "ArrowUp" });
		fireEvent.keyDown(grid(), { key: "ArrowLeft" });
		fireEvent.keyDown(grid(), { key: "ArrowLeft" });
		fireEvent.keyDown(grid(), { key: "ArrowLeft" });
		expect(screen.getByTestId("at").textContent).toBe("A1");
	});

	it("starts an entry when typing, commits on Enter and moves down, and Escape throws it away", () => {
		const log = fresh();
		render(<Harness log={log} />);
		fireEvent.keyDown(grid(), { key: "ArrowDown" });
		fireEvent.keyDown(grid(), { key: "=" });
		const input = screen.getByLabelText("Edit A2") as HTMLInputElement;
		expect(input.value).toBe("=");
		fireEvent.change(input, { target: { value: "=SUM(1,2)" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(log.commits).toEqual([["A2", "=SUM(1,2)"]]);
		expect(screen.getByTestId("at").textContent).toBe("A3");
		fireEvent.keyDown(grid(), { key: "x" });
		fireEvent.keyDown(screen.getByLabelText("Edit A3"), { key: "Escape" });
		expect(screen.queryByLabelText("Edit A3")).toBeNull();
		expect(log.commits).toHaveLength(1);
	});

	it("edits a cell with its typed text on Enter and Tab moves right after the entry", () => {
		const log = fresh();
		render(<Harness log={log} />);
		fireEvent.keyDown(grid(), { key: "Enter" });
		const input = screen.getByLabelText("Edit A1") as HTMLInputElement;
		expect(input.value).toBe("hello");
		fireEvent.change(input, { target: { value: "bye" } });
		fireEvent.keyDown(input, { key: "Tab" });
		expect(log.commits).toEqual([["A1", "bye"]]);
		expect(screen.getByTestId("at").textContent).toBe("B1");
		// Leaving an entry unchanged commits nothing
		fireEvent.keyDown(grid(), { key: "Enter" });
		fireEvent.keyDown(screen.getByLabelText("Edit B1"), { key: "Enter" });
		expect(log.commits).toHaveLength(1);
	});

	it("clears the selection on Delete, and copies and pastes tab-separated text", () => {
		const log = fresh();
		render(<Harness log={log} />);
		fireEvent.keyDown(grid(), { key: "ArrowRight", shiftKey: true });
		fireEvent.keyDown(grid(), { key: "Delete" });
		expect(log.clears).toEqual([{ r0: 0, c0: 0, r1: 0, c1: 1 }]);
		const data: Record<string, string> = {};
		fireEvent.copy(grid(), { clipboardData: { setData: (t: string, v: string) => (data[t] = v) } });
		expect(data["text/plain"]).toBe("hello\t12");
		act(() => {
			fireEvent.paste(grid(), { clipboardData: { getData: () => "a\tb\n1\t2" } });
		});
		expect(log.pastes).toEqual([[{ row: 0, col: 0 }, [["a", "b"], ["1", "2"]]]]);
	});

	it("does not let a reader type, clear or paste", () => {
		const log = fresh();
		render(<Harness log={log} readOnly />);
		fireEvent.keyDown(grid(), { key: "x" });
		fireEvent.keyDown(grid(), { key: "Enter" });
		fireEvent.keyDown(grid(), { key: "Delete" });
		fireEvent.paste(grid(), { clipboardData: { getData: () => "a" } });
		expect(screen.queryByLabelText("Edit A1")).toBeNull();
		expect(log.clears).toEqual([]);
		expect(log.pastes).toEqual([]);
		// but they can still move around
		fireEvent.keyDown(grid(), { key: "ArrowDown" });
		expect(screen.getByTestId("at").textContent).toBe("A2");
		vi.restoreAllMocks();
	});

	it("selects a cell with the mouse and a block by dragging", () => {
		render(<Harness log={fresh()} />);
		const cell = (r: number, c: number) => document.querySelector(`[data-r="${r}"][data-c="${c}"]`) as HTMLElement;
		fireEvent.mouseDown(cell(2, 1));
		expect(screen.getByTestId("at").textContent).toBe("B3");
		fireEvent.mouseMove(cell(4, 3));
		expect(screen.getByTestId("sel").textContent).toBe("2,1:4,3");
		fireEvent.mouseUp(window);
		fireEvent.mouseMove(cell(6, 5));
		expect(screen.getByTestId("sel").textContent).toBe("2,1:4,3");
	});
});

describe("SheetGrid looks", () => {
	it("draws fills, weights and alignment, and keeps frozen rows in view", () => {
		render(
			<SheetGrid
				rows={100}
				cols={26}
				shown={{ A1: { text: "Head", kind: "text" }, A2: { text: "x", kind: "text" } }}
				typed={() => ""}
				look={(a1) => (a1 === "A1" ? { bold: true, fill: "#217346", color: "#ffffff", align: "center", borders: "b" } : {})}
				freeze={[1, 0]}
				readOnly={false}
				others={[]}
				active={{ row: 0, col: 0 }}
				selection={normalise({ row: 0, col: 0 }, { row: 0, col: 0 })}
				onMove={() => {}}
				onCommit={() => {}}
				onClear={() => {}}
				onPaste={() => {}}
			/>,
		);
		const head = document.querySelector('[data-r="0"][data-c="0"]') as HTMLElement;
		expect([head.style.fontWeight, head.style.textAlign, head.style.background.includes("rgb(33, 115, 70)"), head.style.borderBottom]).toEqual(["700", "center", true, "1px solid rgb(64, 64, 64)"]);
		expect(head.className).toContain("z-[5]");
		// A cell below the frozen row is not held in place
		expect((document.querySelector('[data-r="1"][data-c="0"]') as HTMLElement).className).not.toContain("z-[5]");
	});
});
