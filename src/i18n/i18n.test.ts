import { afterEach, describe, expect, it } from "vitest";

import { formatNumber, locale, registerLocale, setLocale, t } from "./index";

afterEach(() => setLocale("en"));

describe("i18n scaffold", () => {
	it("looks text up and fills placeholders", () => {
		expect(t("nav.notes")).toBe("Notes");
		expect(t("tour.step", { current: 2, total: 4 })).toBe("Step 2 of 4");
		expect(t("welcome.evening", { name: "Yash" })).toBe("Good evening, Yash.");
		expect(t("welcome.evening")).toBe("Good evening, {name}.");
	});

	it("uses a registered language, falls back to English for missing keys, and to the base language for a region", () => {
		registerLocale("xx", { "nav.notes": "Notizen" });
		expect(setLocale("xx-YY")).toBe("xx");
		expect(locale()).toBe("xx");
		expect(t("nav.notes")).toBe("Notizen");
		expect(t("nav.tasks")).toBe("Tasks");
		expect(document.documentElement.lang).toBe("xx");
	});

	it("stays on English for a language nobody registered", () => {
		expect(setLocale("zz")).toBe("en");
		expect(formatNumber(1234.5)).toBe("1,234.5");
	});
});
