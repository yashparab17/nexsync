import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import NotificationBell from "@/components/layout/workspace/NotificationBell";
import { MAX_NOTIFICATIONS, NotificationProvider, useNotifications } from "./NotificationContext";

afterEach(cleanup);

let api: ReturnType<typeof useNotifications>;
function Probe() {
	api = useNotifications();
	return null;
}
const mount = () =>
	render(
		<NotificationProvider>
			<Probe />
			<NotificationBell />
		</NotificationProvider>,
	);

describe("notifications", () => {
	it("counts unread ones, newest first, and reading them clears the count", () => {
		mount();
		act(() => api.notify("Ann joined the workspace"));
		act(() => api.notify('Ann assigned you "Ship"'));
		expect(api.unread).toBe(2);
		expect(api.items[0].text).toBe('Ann assigned you "Ship"');

		fireEvent.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));
		expect(api.unread).toBe(0);
		expect(screen.getByText("Ann joined the workspace")).toBeTruthy();
	});

	it("can be cleared, and says so when there is nothing", () => {
		mount();
		act(() => api.notify("Something"));
		fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
		fireEvent.click(screen.getByRole("button", { name: "Clear" }));
		expect(api.items).toHaveLength(0);
		expect(screen.getByText(/nothing yet/i)).toBeTruthy();
	});

	it("keeps only the most recent ones", () => {
		mount();
		act(() => {
			for (let i = 0; i < MAX_NOTIFICATIONS + 5; i++) api.notify(`n${i}`);
		});
		expect(api.items).toHaveLength(MAX_NOTIFICATIONS);
		expect(api.items[0].text).toBe(`n${MAX_NOTIFICATIONS + 4}`);
	});

	it("does nothing, and does not throw, without a provider", () => {
		render(<Probe />);
		expect(() => api.notify("ignored")).not.toThrow();
		expect(api.items).toEqual([]);
	});
});
