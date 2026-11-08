import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import SlideShow from "@/features/office/slides/components/SlideShow";

const mocks = vi.hoisted(() => {
	const win = { setFullscreen: vi.fn(async () => {}), setPosition: vi.fn(async () => {}), close: vi.fn(async () => {}), once: vi.fn(async (_e: string, cb: () => void) => { if (_e === "tauri://created") queueMicrotask(cb); }) };
	return {
		win,
		current: { setFullscreen: vi.fn(async () => {}) },
		emit: vi.fn(async () => {}),
		listeners: new Map<string, (e: { payload: unknown }) => void>(),
		monitors: [] as { name: string; position: { x: number; y: number }; size: { width: number; height: number } }[],
		created: [] as unknown[],
	};
});

vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => mocks.current,
	availableMonitors: async () => mocks.monitors,
	currentMonitor: async () => mocks.monitors[0] ?? null,
	PhysicalPosition: class {
		constructor(public x: number, public y: number) {}
	},
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
	WebviewWindow: Object.assign(
		class {
			constructor(label: string, opts: unknown) {
				mocks.created.push({ label, opts });
				return mocks.win as never;
			}
		},
		{ getByLabel: async () => mocks.win },
	),
}));
vi.mock("@tauri-apps/api/event", () => ({
	emit: mocks.emit,
	listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
		mocks.listeners.set(name, cb);
		return () => mocks.listeners.delete(name);
	},
}));

vi.mock("@/features/office/slides/lib/deck", () => ({
	readSlide: (_doc: unknown, k: string) => ({ id: k, hidden: k === "b", shapes: [] }),
	notesOf: (s: { id: string }) => (s.id === "a" ? "Say hello first" : ""),
	transitionOf: () => "none",
}));

const props = (over: object = {}) => ({ doc: new Y.Doc(), keys: ["a", "b", "c"], start: 0, deck: { id: "base", render: async () => ({ png: "AAAA", widthPt: 960, heightPt: 540, frames: [] }), layouts: async () => [], newSlide: async () => "", applyLayout: async () => "" }, presenterView: false, slideSize: { w: 960, h: 540 }, onShow: vi.fn(), onClose: vi.fn(), ...over });

describe("the slide show", () => {
	beforeEach(() => {
		vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
		mocks.current.setFullscreen.mockClear();
		mocks.emit.mockClear();
		mocks.listeners.clear();
		mocks.created.length = 0;
		mocks.monitors = [{ name: "laptop", position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }];
	});
	afterEach(cleanup);

	it("goes full screen, skips hidden slides, and gives the screen back when it ends", async () => {
		const p = props();
		const { unmount } = render(<SlideShow {...p} />);
		await waitFor(() => expect(mocks.current.setFullscreen).toHaveBeenCalledWith(true));
		expect(p.onShow).toHaveBeenLastCalledWith(0);
		fireEvent.keyDown(window, { key: "ArrowRight" });
		// "b" is hidden, so the next slide is "c"
		expect(p.onShow).toHaveBeenLastCalledWith(2);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(p.onClose).toHaveBeenCalled();
		unmount();
		await waitFor(() => expect(mocks.current.setFullscreen).toHaveBeenLastCalledWith(false));
	});

	it("jumps to a typed slide number and puts up a black screen on B", () => {
		const p = props({ keys: ["a", "c", "d", "e"] });
		render(<SlideShow {...p} />);
		fireEvent.keyDown(window, { key: "3" });
		fireEvent.keyDown(window, { key: "Enter" });
		expect(p.onShow).toHaveBeenLastCalledWith(2);
		fireEvent.keyDown(window, { key: "b" });
		expect(screen.getByRole("dialog").style.background).toContain("rgb(0, 0, 0)");
	});

	it("opens the audience's window on the other screen and shows the notes here", async () => {
		mocks.monitors = [...mocks.monitors, { name: "projector", position: { x: 1920, y: 0 }, size: { width: 1920, height: 1080 } }];
		const p = props({ presenterView: true });
		render(<SlideShow {...p} />);
		expect(await screen.findByText("Say hello first")).toBeTruthy();
		await waitFor(() => expect(mocks.win.setFullscreen).toHaveBeenCalledWith(true));
		expect(mocks.created).toHaveLength(1);
		expect((mocks.created[0] as { label: string; opts: { decorations: boolean } }).label).toBe("audience");
		// With a second screen the audience's window has no frame and goes full screen there
		expect((mocks.created[0] as { opts: { decorations: boolean } }).opts.decorations).toBe(false);
		await waitFor(() => expect(mocks.emit).toHaveBeenCalledWith("show://state", expect.objectContaining({ index: 0, total: 2 })));
		// A move made on the audience's screen moves the show here too
		act(() => mocks.listeners.get("show://nav")?.({ payload: { by: 1 } }));
		await waitFor(() => expect(mocks.emit).toHaveBeenCalledWith("show://state", expect.objectContaining({ index: 1 })));
	});

	it("falls back to the slide alone when the second window cannot open", async () => {
		const original = mocks.win.once;
		mocks.monitors = [...mocks.monitors, { name: "projector", position: { x: 1920, y: 0 }, size: { width: 1920, height: 1080 } }];
		mocks.win.once = vi.fn(async (e: string, cb: (x: { payload: string }) => void) => {
			if (e === "tauri://error") queueMicrotask(() => cb({ payload: "denied" }));
		}) as never;
		render(<SlideShow {...props({ presenterView: true })} />);
		expect(await screen.findByText(/second window could not open/)).toBeTruthy();
		mocks.win.once = original;
	});

	it("keeps the slide alone on one screen instead of opening a window over the notes", async () => {
		render(<SlideShow {...props({ presenterView: true })} />);
		await waitFor(() => expect(screen.getByRole("dialog", { name: "Slide show" })).toBeTruthy());
		expect(mocks.created).toHaveLength(0);
	});
});
