import { beforeEach, describe, expect, it } from "vitest";

import { readPopupsMuted, savePopupsMuted } from "@/lib/popupPrefs";

beforeEach(() => localStorage.clear());

describe("muting pop-ups", () => {
	it("is off until it is turned on, and the choice is kept", () => {
		expect(readPopupsMuted()).toBe(false);
		savePopupsMuted(true);
		expect(readPopupsMuted()).toBe(true);
		savePopupsMuted(false);
		expect(readPopupsMuted()).toBe(false);
	});
});
