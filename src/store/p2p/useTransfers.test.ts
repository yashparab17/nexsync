import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Progress = { peerId: string; relPath: string; receivedBytes: number; totalBytes: number };
const h = vi.hoisted(() => ({ onProgress: null as null | ((e: Progress) => void), onEnded: null as null | ((e: { peerId: string; relPath: string }) => void), cancel: vi.fn(async () => 1), send: vi.fn(async () => {}) }));
vi.mock("@/lib/p2p", () => ({
	p2p: {
		onFileProgress: (cb: (e: Progress) => void) => ((h.onProgress = cb), () => {}),
		onFileEnded: (cb: (e: { peerId: string; relPath: string }) => void) => ((h.onEnded = cb), () => {}),
		cancelTransfers: h.cancel,
		sendMessage: h.send,
	},
}));

import { useTransfers } from "./useTransfers";
import { useWorkspaceDeleted } from "./useWorkspaceDeleted";

beforeEach(() => vi.clearAllMocks());

describe("useTransfers", () => {
	it("tracks progress per file and drops a file when it ends", () => {
		const { result } = renderHook(() => useTransfers());
		act(() => h.onProgress!({ peerId: "p", relPath: "a.txt", receivedBytes: 1, totalBytes: 10 }));
		act(() => h.onProgress!({ peerId: "p", relPath: "a.txt", receivedBytes: 5, totalBytes: 10 }));
		act(() => h.onProgress!({ peerId: "p", relPath: "b.txt", receivedBytes: 2, totalBytes: 4 }));
		expect(result.current.transfers.map((t) => `${t.relPath}:${t.receivedBytes}`).sort()).toEqual(["a.txt:5", "b.txt:2"]);
		act(() => h.onEnded!({ peerId: "p", relPath: "a.txt" }));
		expect(result.current.transfers.map((t) => t.relPath)).toEqual(["b.txt"]);
	});

	it("marks everything cancelled only when no single file is named", async () => {
		const { result } = renderHook(() => useTransfers());
		await act(() => result.current.cancelTransfers("a.txt"));
		expect(result.current.cancelledRef.current).toBe(false);
		await act(() => result.current.cancelTransfers());
		expect(result.current.cancelledRef.current).toBe(true);
		expect(h.cancel).toHaveBeenCalledTimes(2);
	});
});

describe("useWorkspaceDeleted", () => {
	it("is set by the host's message and cleared by dismissing", () => {
		const { result } = renderHook(() => useWorkspaceDeleted());
		expect(result.current.workspaceDeleted).toBe(false);
		act(() => result.current.markWorkspaceDeleted());
		expect(result.current.workspaceDeleted).toBe(true);
		act(() => result.current.dismissWorkspaceDeleted());
		expect(result.current.workspaceDeleted).toBe(false);
	});

	it("tells the guests, then waits for the message to arrive", async () => {
		vi.useFakeTimers();
		const { result } = renderHook(() => useWorkspaceDeleted());
		const done = result.current.announceWorkspaceDeleted();
		await vi.advanceTimersByTimeAsync(700);
		await done;
		expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "WORKSPACE_DELETED" }));
		vi.useRealTimers();
	});
});
