import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { useOpenParam } from "@/hooks/useOpenParam";

function setup(url: string, onOpen: (v: string) => void, ready: boolean) {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
	);
	return renderHook(
		() => {
			useOpenParam(onOpen, ready);
			return useLocation();
		},
		{ wrapper },
	);
}

describe("useOpenParam", () => {
	it("calls onOpen once with the value and clears the param", () => {
		const onOpen = vi.fn();
		const { result } = setup("/notes?open=%2Fnotes%2Fa.md", onOpen, true);
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(onOpen).toHaveBeenCalledWith("/notes/a.md");
		expect(result.current.search).toBe("");
	});

	it("waits until the page data is ready", () => {
		const onOpen = vi.fn();
		const { result } = setup("/tasks?open=42", onOpen, false);
		expect(onOpen).not.toHaveBeenCalled();
		expect(result.current.search).toBe("?open=42");
	});

	it("does nothing without the param", () => {
		const onOpen = vi.fn();
		setup("/tasks", onOpen, true);
		expect(onOpen).not.toHaveBeenCalled();
	});
});
