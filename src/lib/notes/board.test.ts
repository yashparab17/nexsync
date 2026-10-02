import { describe, expect, it } from "vitest";

import { clampZoom, positionsFor, summarize, gridSlot } from "./board";
import { buildEdges, degrees, layoutGraph } from "./graph";

const note = (name: string, text: string) => ({ path: `/notes/${name}`, name, text });

describe("link graph", () => {
	const notes = [
		note("Plan.txt", "See [[Ideas]] and [[Ideas|again]] and [[Plan]] and [[Missing]]"),
		note("Ideas.txt", "Back to [[plan]]"),
		note("Alone.txt", "no links"),
	];

	it("links notes once per pair, ignoring itself and notes that do not exist", () => {
		expect(buildEdges(notes)).toEqual([
			{ from: "/notes/Plan.txt", to: "/notes/Ideas.txt" },
			{ from: "/notes/Ideas.txt", to: "/notes/Plan.txt" },
		]);
	});

	it("counts links in and out", () => {
		const d = degrees(notes.map((n) => n.path), buildEdges(notes));
		expect(d.get("/notes/Plan.txt")).toBe(2);
		expect(d.get("/notes/Alone.txt")).toBe(0);
	});

	it("lays notes out the same way every time, inside the frame, with linked notes closer than unlinked ones", () => {
		const paths = notes.map((n) => n.path);
		const a = layoutGraph(paths, buildEdges(notes), 800, 600);
		const b = layoutGraph(paths, buildEdges(notes), 800, 600);
		expect([...a]).toEqual([...b]);
		for (const p of a.values()) {
			expect(p.x).toBeGreaterThanOrEqual(40);
			expect(p.x).toBeLessThanOrEqual(760);
			expect(p.y).toBeGreaterThanOrEqual(40);
			expect(p.y).toBeLessThanOrEqual(560);
		}
		const dist = (x: string, y: string) => Math.hypot(a.get(x)!.x - a.get(y)!.x, a.get(x)!.y - a.get(y)!.y);
		expect(dist("/notes/Plan.txt", "/notes/Ideas.txt")).toBeLessThan(dist("/notes/Plan.txt", "/notes/Alone.txt"));
	});

	it("copes with no notes and one note", () => {
		expect(layoutGraph([], [], 800, 600).size).toBe(0);
		expect(layoutGraph(["/a"], [], 800, 600).get("/a")).toEqual({ x: 400, y: 300 });
	});
});

describe("note board", () => {
	it("keeps dragged positions and puts new notes on the grid", () => {
		const out = positionsFor(["/b", "/a"], { "/b": { x: 500, y: 400 } });
		expect(out["/b"]).toEqual({ x: 500, y: 400 });
		expect(out["/a"]).toEqual(gridSlot(0));
	});

	it("ignores a stored position that is not a number", () => {
		expect(positionsFor(["/a"], { "/a": { x: Number.NaN, y: 1 } })["/a"]).toEqual(gridSlot(0));
	});

	it("shows the headings and a snippet without repeating the heading lines", () => {
		const s = summarize("# Title\nFirst line\n## Part\nSecond line\n", 5, 20);
		expect(s.headings.map((h) => [h.level, h.text])).toEqual([[1, "Title"], [2, "Part"]]);
		expect(s.snippet).toBe("First line Second li…");
	});

	it("keeps the zoom in range", () => {
		expect(clampZoom(10)).toBe(2);
		expect(clampZoom(0)).toBe(0.3);
		expect(clampZoom(1)).toBe(1);
	});
});
