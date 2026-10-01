import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import Toaster from "./Toaster";
import { NotificationProvider, useNotifications } from "@/store/notifications/NotificationContext";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

let notify: (text: string) => void = () => {};
function Probe() {
	notify = useNotifications().notify;
	return null;
}
const setup = () =>
	render(
		<NotificationProvider>
			<Probe />
			<Toaster />
		</NotificationProvider>,
	);

describe("toasts", () => {
	it("shows a new notification, announces it politely, and lets it be dismissed", () => {
		setup();
		expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
		act(() => notify("Raven joined the workspace"));
		expect(screen.getByText("Raven joined the workspace")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
		expect(screen.queryByText("Raven joined the workspace")).toBeNull();
	});

	it("goes away by itself, each one on its own timer", () => {
		vi.useFakeTimers();
		setup();
		act(() => notify("first"));
		act(() => void vi.advanceTimersByTime(4000));
		act(() => notify("second"));
		act(() => void vi.advanceTimersByTime(3000));
		expect(screen.queryByText("first")).toBeNull();
		expect(screen.getByText("second")).toBeTruthy();
		act(() => void vi.advanceTimersByTime(4000));
		expect(screen.queryByText("second")).toBeNull();
	});
});
