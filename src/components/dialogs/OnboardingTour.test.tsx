import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import OnboardingTour, { tourSeen } from "./OnboardingTour";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("onboarding tour", () => {
	it("steps through four screens, then remembers it was seen", () => {
		const onClose = vi.fn();
		render(<OnboardingTour open onClose={onClose} />);
		expect(tourSeen()).toBe(false);
		expect(screen.getByText("Step 1 of 4")).toBeTruthy();
		for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(screen.getByText("Step 4 of 4")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Back" }));
		expect(screen.getByText("Step 3 of 4")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		fireEvent.click(screen.getByRole("button", { name: "Get started" }));
		expect(onClose).toHaveBeenCalled();
		expect(tourSeen()).toBe(true);
	});

	it("can be skipped, which also counts as seen", () => {
		const onClose = vi.fn();
		render(<OnboardingTour open onClose={onClose} />);
		fireEvent.click(screen.getByRole("button", { name: "Skip" }));
		expect(onClose).toHaveBeenCalled();
		expect(tourSeen()).toBe(true);
	});
});
