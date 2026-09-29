import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/lib/tauri", () => ({ recordFileVersion: vi.fn(async () => {}) }));

import { recordFileVersion } from "@/lib/tauri";
import { useAutoSnapshot } from "./useAutoSnapshot";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("useAutoSnapshot", () => {
	it("snapshots the text every two minutes, and only when it changed", () => {
		const { rerender } = renderHook(({ text }) => useAutoSnapshot("/w", "notes/a.md", text, true), { initialProps: { text: "one" } });
		vi.advanceTimersByTime(2 * 60 * 1000);
		expect(recordFileVersion).toHaveBeenCalledTimes(1);
		expect(recordFileVersion).toHaveBeenLastCalledWith("/w", "notes/a.md", "one");
		vi.advanceTimersByTime(2 * 60 * 1000);
		expect(recordFileVersion).toHaveBeenCalledTimes(1);
		rerender({ text: "two" });
		vi.advanceTimersByTime(2 * 60 * 1000);
		expect(recordFileVersion).toHaveBeenCalledTimes(2);
		expect(recordFileVersion).toHaveBeenLastCalledWith("/w", "notes/a.md", "two");
	});

	it("keeps what was typed when the editor closes", () => {
		const { rerender, unmount } = renderHook(({ text }) => useAutoSnapshot("/w", "a.txt", text, true), { initialProps: { text: "start" } });
		rerender({ text: "start and more" });
		unmount();
		expect(recordFileVersion).toHaveBeenLastCalledWith("/w", "a.txt", "start and more");
	});

	it("does nothing for an empty text or a viewer", () => {
		renderHook(() => useAutoSnapshot("/w", "a.txt", "  ", true)).unmount();
		renderHook(() => useAutoSnapshot("/w", "a.txt", "text", false)).unmount();
		vi.advanceTimersByTime(5 * 60 * 1000);
		expect(recordFileVersion).not.toHaveBeenCalled();
	});
});
