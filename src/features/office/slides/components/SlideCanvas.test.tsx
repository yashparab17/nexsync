import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import SlideCanvas from "@/features/office/slides/components/SlideCanvas";
import type { Frame } from "@/features/office/slides/lib/deck";
import type { DeckRendered } from "@/lib/tauri";

afterEach(cleanup);

beforeAll(() => {
	HTMLElement.prototype.setPointerCapture = () => {};
});

const frame = (id: number, x: number, y: number, w: number, h: number): Frame => ({ id, name: `shape ${id}`, x, y, w, h, rot: 0, kind: "shape", placeholder: false });
const image: DeckRendered = { png: "AAAA", widthPt: 960, heightPt: 540, frames: [frame(1, 100, 100, 200, 100), frame(2, 500, 300, 100, 100)] };

// 480 px wide shows the 960-point slide at half size, so one point is half a pixel
function setup(over: Partial<React.ComponentProps<typeof SlideCanvas>> = {}) {
	const calls = { select: [] as (number | null)[], box: [] as [number, unknown][], del: [] as number[], text: [] as [number, string][] };
	render(
		<SlideCanvas
			image={image}
			displayWidth={480}
			selected={null}
			others={[]}
			readOnly={false}
			text={(id) => (id === 1 ? "Hello" : "")}
			onSelect={(id) => calls.select.push(id)}
			onBox={(id, b) => calls.box.push([id, b])}
			onDelete={(id) => calls.del.push(id)}
			onText={(id, t) => calls.text.push([id, t])}
			{...over}
		/>,
	);
	return calls;
}

const frameEl = (id: number) => document.querySelector(`[data-frame="${id}"]`) as HTMLElement;

describe("SlideCanvas", () => {
	it("puts each frame where its shape is, at the size the slide is shown", () => {
		setup();
		expect(frameEl(1).style.left).toBe("50px");
		expect(frameEl(1).style.top).toBe("50px");
		expect(frameEl(1).style.width).toBe("100px");
		expect(frameEl(2).style.left).toBe("250px");
	});

	it("selects a shape by pressing it and nothing by pressing the slide", () => {
		const calls = setup();
		fireEvent.pointerDown(frameEl(2), { clientX: 0, clientY: 0 });
		fireEvent.pointerDown(screen.getByLabelText("Slide"));
		expect(calls.select).toEqual([2, null]);
	});

	it("moves a shape by dragging, in points, and reports it once when let go", () => {
		const calls = setup({ selected: 1 });
		fireEvent.pointerDown(frameEl(1), { clientX: 100, clientY: 100, pointerId: 1 });
		fireEvent.pointerMove(frameEl(1), { clientX: 130, clientY: 90, pointerId: 1 });
		// While dragging the frame follows the pointer
		expect(frameEl(1).style.left).toBe("80px");
		fireEvent.pointerUp(frameEl(1), { pointerId: 1 });
		expect(calls.box).toEqual([[1, { x: 160, y: 80, w: 200, h: 100, rot: 0 }]]);
	});

	it("resizes from a corner handle", () => {
		const calls = setup({ selected: 1 });
		const handles = frameEl(1).querySelectorAll("span");
		expect(handles).toHaveLength(8);
		const se = [...handles].find((h) => (h as HTMLElement).style.cursor === "nwse-resize" && (h as HTMLElement).style.right === "-4px")!;
		fireEvent.pointerDown(se, { clientX: 150, clientY: 100, pointerId: 1 });
		fireEvent.pointerMove(se, { clientX: 160, clientY: 110, pointerId: 1 });
		fireEvent.pointerUp(se, { pointerId: 1 });
		expect(calls.box).toEqual([[1, { x: 100, y: 100, w: 220, h: 120, rot: 0 }]]);
	});

	it("nudges with the arrow keys, deletes, and types into a shape", () => {
		const calls = setup({ selected: 1 });
		const slide = screen.getByLabelText("Slide");
		fireEvent.keyDown(slide, { key: "ArrowRight" });
		fireEvent.keyDown(slide, { key: "ArrowUp", shiftKey: true });
		expect(calls.box.map(([, b]) => b)).toEqual([{ x: 101, y: 100, w: 200, h: 100, rot: 0 }, { x: 100, y: 90, w: 200, h: 100, rot: 0 }]);
		fireEvent.keyDown(slide, { key: "Delete" });
		expect(calls.del).toEqual([1]);
		fireEvent.keyDown(slide, { key: "Enter" });
		const box = screen.getByLabelText("Text of the shape") as HTMLTextAreaElement;
		expect(box.value).toBe("Hello");
		fireEvent.change(box, { target: { value: "Bye" } });
		fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
		expect(calls.text).toEqual([[1, "Bye"]]);
		// Escape throws a half-typed text away
		fireEvent.keyDown(slide, { key: "Enter" });
		fireEvent.change(screen.getByLabelText("Text of the shape"), { target: { value: "Nope" } });
		fireEvent.keyDown(screen.getByLabelText("Text of the shape"), { key: "Escape" });
		expect(calls.text).toHaveLength(1);
	});

	it("lets a reader select but not move, delete or type", () => {
		const calls = setup({ selected: 1, readOnly: true });
		fireEvent.pointerDown(frameEl(2), { clientX: 0, clientY: 0, pointerId: 1 });
		fireEvent.pointerMove(frameEl(2), { clientX: 50, clientY: 50, pointerId: 1 });
		fireEvent.pointerUp(frameEl(2), { pointerId: 1 });
		fireEvent.keyDown(screen.getByLabelText("Slide"), { key: "Delete" });
		fireEvent.keyDown(screen.getByLabelText("Slide"), { key: "Enter" });
		fireEvent.doubleClick(frameEl(1));
		expect(calls.select).toEqual([2]);
		expect(calls.box).toEqual([]);
		expect(calls.del).toEqual([]);
		expect(screen.queryByLabelText("Text of the shape")).toBeNull();
		vi.restoreAllMocks();
	});

	it("shows the name of someone else who has a shape selected", () => {
		setup({ others: [{ id: 2, name: "Ben", color: "#d22d64" }] });
		expect(screen.getByText("Ben")).toBeTruthy();
	});
});
