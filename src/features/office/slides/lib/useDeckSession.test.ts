import { act, renderHook, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/office/lib/api", () => ({ deckRegister: vi.fn(), deckRender: vi.fn(), deckLayouts: vi.fn(), deckNewSlide: vi.fn(), deckApplyLayout: vi.fn() }));
vi.mock("@/features/office/slides/lib/deck", () => ({ getBase: () => "base-text" }));

import { deckRegister, deckRender } from "@/features/office/lib/api";
import { useDeckSession } from "./useDeckSession";

const doc = new Y.Doc();
const png = { png: "x", widthPt: 960, heightPt: 540, frames: [] };

beforeEach(() => {
	vi.mocked(deckRegister).mockReset().mockResolvedValueOnce("id1").mockResolvedValue("id2");
	vi.mocked(deckRender).mockReset();
});

describe("useDeckSession", () => {
	it("registers the base and hands out its id", async () => {
		const { result } = renderHook(() => useDeckSession(doc, vi.fn()));
		await waitFor(() => expect(result.current.id).toBe("id1"));
	});

	it("registers again and retries once when the backend no longer has the base", async () => {
		vi.mocked(deckRender).mockRejectedValueOnce(new Error("unknown base")).mockResolvedValue(png);
		const { result } = renderHook(() => useDeckSession(doc, vi.fn()));
		await waitFor(() => expect(result.current.id).toBe("id1"));
		let out;
		await act(async () => {
			out = await result.current.render("{}", 1);
		});
		expect(out).toBe(png);
		expect(vi.mocked(deckRender).mock.calls.map((c) => c[0])).toEqual(["id1", "id2"]);
		await waitFor(() => expect(result.current.id).toBe("id2"));
	});

	it("passes other errors on without retrying", async () => {
		vi.mocked(deckRender).mockRejectedValue(new Error("boom"));
		const { result } = renderHook(() => useDeckSession(doc, vi.fn()));
		await waitFor(() => expect(result.current.id).toBe("id1"));
		await expect(result.current.render("{}", 1)).rejects.toThrow("boom");
		expect(deckRender).toHaveBeenCalledTimes(1);
	});
});
