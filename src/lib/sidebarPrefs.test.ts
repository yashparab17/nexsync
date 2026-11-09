import { describe, expect, it } from "vitest";
import { applyOrder, moveBefore, parsePrefs, shift, togglePin } from "@/lib/sidebarPrefs";

describe("sidebar prefs", () => {
	it("falls back for junk", () => {
		expect(parsePrefs("x")).toEqual({ pinned: [], order: {} });
		expect(parsePrefs({ pinned: ["/a", 3, "/a"], order: { g: ["/b"] } })).toEqual({ pinned: ["/a"], order: { g: ["/b"] } });
	});
	it("pins and unpins", () => {
		const on = togglePin({ pinned: [], order: {} }, "/a");
		expect(on.pinned).toEqual(["/a"]);
		expect(togglePin(on, "/a").pinned).toEqual([]);
	});
	it("orders known paths first and keeps new ones last", () => {
		const items = [{ path: "/a" }, { path: "/b" }, { path: "/c" }];
		expect(applyOrder(items, ["/c", "/a"]).map((i) => i.path)).toEqual(["/c", "/a", "/b"]);
	});
	it("moves one path before another", () => {
		expect(moveBefore(["/a", "/b", "/c"], "/c", "/a")).toEqual(["/c", "/a", "/b"]);
		expect(shift(["/a", "/b"], "/a", 1)).toEqual(["/b", "/a"]);
		expect(shift(["/a", "/b"], "/a", -1)).toEqual(["/a", "/b"]);
	});
});
