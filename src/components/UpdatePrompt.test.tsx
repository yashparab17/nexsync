import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updater = { status: "idle", version: null as string | null, notes: null as string | null, error: null, channel: "stable", checkForUpdate: vi.fn(), installUpdate: vi.fn() };
vi.mock("@/hooks/useAppUpdater", () => ({ useAppUpdater: () => updater }));

import UpdatePrompt, { CHECK_DELAY_MS, SKIPPED_KEY } from "@/components/UpdatePrompt";

beforeEach(() => {
	vi.useFakeTimers();
	localStorage.clear();
	updater.status = "idle";
	updater.version = null;
	updater.notes = null;
	updater.checkForUpdate.mockClear();
	updater.installUpdate.mockClear();
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("the update check at launch", () => {
	it("checks once, a few seconds after the desktop app starts, and not in a browser", () => {
		render(<UpdatePrompt />);
		act(() => void vi.advanceTimersByTime(CHECK_DELAY_MS + 100));
		expect(updater.checkForUpdate).not.toHaveBeenCalled();
		cleanup();
		(window as unknown as { __TAURI_INTERNALS__: object }).__TAURI_INTERNALS__ = {};
		render(<UpdatePrompt />);
		act(() => void vi.advanceTimersByTime(CHECK_DELAY_MS - 100));
		expect(updater.checkForUpdate).not.toHaveBeenCalled();
		act(() => void vi.advanceTimersByTime(200));
		expect(updater.checkForUpdate).toHaveBeenCalledTimes(1);
	});

	it("says nothing while there is nothing new", () => {
		render(<UpdatePrompt />);
		expect(screen.queryByRole("status")).toBeNull();
		updater.status = "up-to-date";
		expect(render(<UpdatePrompt />).container.textContent).toBe("");
	});

	it("offers a newer version with its notes, and installs it on request", () => {
		updater.status = "available";
		updater.version = "0.9.1";
		updater.notes = "Fixes the footnote dialog.";
		render(<UpdatePrompt />);
		expect(screen.getByText("Nexsync 0.9.1 is ready")).toBeTruthy();
		expect(screen.getByText("Fixes the footnote dialog.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Update & restart" }));
		expect(updater.installUpdate).toHaveBeenCalled();
	});

	it("goes away for this session on Later, and for good on Skip this version, but not for a newer one", () => {
		updater.status = "available";
		updater.version = "0.9.1";
		const later = render(<UpdatePrompt />);
		fireEvent.click(screen.getByRole("button", { name: "Later" }));
		expect(later.container.textContent).toBe("");
		cleanup();
		render(<UpdatePrompt />);
		fireEvent.click(screen.getByRole("button", { name: "Skip this version" }));
		expect(localStorage.getItem(SKIPPED_KEY)).toBe("0.9.1");
		cleanup();
		expect(render(<UpdatePrompt />).container.textContent).toBe("");
		cleanup();
		updater.version = "0.9.2";
		render(<UpdatePrompt />);
		expect(screen.getByText("Nexsync 0.9.2 is ready")).toBeTruthy();
	});

	it("cannot be pressed twice while it installs", () => {
		updater.status = "installing";
		updater.version = "0.9.1";
		render(<UpdatePrompt />);
		expect(screen.getByRole("button", { name: "Installing…" }).hasAttribute("disabled")).toBe(true);
	});
});
