import { describe, expect, it } from "vitest";

import { DEFAULT_LAYOUT, moveTile, parseLayout } from "./dashboardLayout";

describe("dashboardLayout", () => {
	it("falls back to the default for nothing or nonsense", () => {
		expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
		expect(parseLayout({ order: ["nope"], size: { tasks: "xl" }, hidden: 3 })).toEqual(DEFAULT_LAYOUT);
	});
	it("keeps stored choices and adds tiles added since", () => {
		const l = parseLayout({ order: ["cards", "tasks"], size: { tasks: "l" }, hidden: ["files"] });
		expect(l.order.slice(0, 2)).toEqual(["cards", "tasks"]);
		expect(l.order).toHaveLength(8);
		expect(l.size.tasks).toBe("l");
		expect(l.hidden).toEqual(["files"]);
	});
	it("moves a tile to the place of another", () => {
		expect(moveTile(["pickup", "tasks", "files"], "files", "pickup")).toEqual(["files", "pickup", "tasks"]);
		expect(moveTile(["pickup", "tasks", "files"], "pickup", "files")).toEqual(["tasks", "files", "pickup"]);
	});
});
