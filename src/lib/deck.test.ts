import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { addShape, addSlide, arrange, deleteSlide, dragged, duplicateSlide, getBase, moveSlide, nextShapeId, readSlide, readSlides, removeShape, seed, setShape, slideKeys, textOf, type SlideJson } from "./deck";

const slide = (id: number, shapes: number[]): SlideJson => ({ id, layout: 1, name: `s${id}`, shapes: shapes.map((s) => ({ id: s, name: `shape ${s}`, xfrm: { x: s, y: s, w: 10, h: 10 } })) });

describe("the shared deck", () => {
	it("is filled from a file once, and reads back whole", () => {
		const doc = new Y.Doc();
		expect(seed(doc, '{"base":1}', [JSON.stringify(slide(10, [11, 12])), JSON.stringify(slide(20, [21]))])).toBe(true);
		expect(seed(doc, "{}", [])).toBe(false);
		expect(getBase(doc)).toBe('{"base":1}');
		const keys = slideKeys(doc);
		expect(keys).toHaveLength(2);
		expect(readSlide(doc, keys[0])).toEqual(slide(10, [11, 12]));
		expect(readSlides(doc).map((s) => JSON.parse(s).id)).toEqual([10, 20]);
	});

	it("keeps two people's moves of different shapes and the later move of one shape", () => {
		const a = new Y.Doc();
		seed(a, "{}", [JSON.stringify(slide(10, [11, 12]))]);
		const b = new Y.Doc();
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
		const key = slideKeys(a)[0];
		setShape(a, key, { id: 11, xfrm: { x: 100, y: 0, w: 10, h: 10 } });
		setShape(b, key, { id: 12, xfrm: { x: 0, y: 200, w: 10, h: 10 } });
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
		const [ra, rb] = [readSlide(a, key)!, readSlide(b, key)!];
		expect(ra).toEqual(rb);
		expect(ra.shapes.map((s) => s.xfrm?.x)).toEqual([100, 0]);
		expect(ra.shapes.map((s) => s.xfrm?.y)).toEqual([0, 200]);
	});

	it("adds, orders and removes shapes, and a shape added by two people at once is kept twice", () => {
		const a = new Y.Doc();
		seed(a, "{}", [JSON.stringify(slide(10, [11]))]);
		const b = new Y.Doc();
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
		const key = slideKeys(a)[0];
		addShape(a, key, { id: 12 });
		addShape(b, key, { id: 13 });
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
		expect(readSlide(a, key)!.shapes.map((s) => s.id).sort()).toEqual([11, 12, 13]);
		expect(readSlide(a, key)!.shapes).toEqual(readSlide(b, key)!.shapes);
		arrange(a, key, 11, "front");
		expect(readSlide(a, key)!.shapes.slice(-1)[0].id).toBe(11);
		arrange(a, key, 11, "backward");
		expect(readSlide(a, key)!.shapes.slice(-2)[0].id).toBe(11);
		arrange(a, key, 11, "back");
		expect(readSlide(a, key)!.shapes[0].id).toBe(11);
		removeShape(a, key, 12);
		expect(readSlide(a, key)!.shapes.map((s) => s.id)).not.toContain(12);
		expect(nextShapeId(readSlide(a, key)!)).toBe(14);
	});

	it("adds, copies, moves and deletes slides, always keeping one", () => {
		const doc = new Y.Doc();
		seed(doc, "{}", [JSON.stringify(slide(10, [11]))]);
		const first = slideKeys(doc)[0];
		const second = addSlide(doc, slide(20, [21]));
		const between = addSlide(doc, slide(30, []), first);
		expect(slideKeys(doc)).toEqual([first, between, second]);
		const copy = duplicateSlide(doc, second)!;
		expect(slideKeys(doc)).toEqual([first, between, second, copy]);
		expect(readSlide(doc, copy)!.shapes).toEqual(readSlide(doc, second)!.shapes);
		moveSlide(doc, copy, -3);
		moveSlide(doc, first, -5);
		expect(slideKeys(doc)).toEqual([first, copy, between, second]);
		expect(deleteSlide(doc, between)).toBeNull();
		expect(slideKeys(doc)).toHaveLength(3);
		const one = new Y.Doc();
		seed(one, "{}", [JSON.stringify(slide(1, []))]);
		expect(deleteSlide(one, slideKeys(one)[0])).toMatch(/at least one/);
	});

	it("reads the text of a shape", () => {
		expect(textOf({ id: 1, text: { paragraphs: [{ runs: [{ text: "Hello " }, { text: "deck" }] }, { runs: [] }, { runs: [{ text: "Bye" }] }] } })).toBe("Hello deck\n\nBye");
		expect(textOf({ id: 1, text: null })).toBe("");
	});
});

describe("dragging a frame", () => {
	const box = { x: 100, y: 100, w: 200, h: 100 };
	it("moves it, and resizes from each side without going below a small size", () => {
		expect(dragged(box, "move", 10, -5)).toEqual({ x: 110, y: 95, w: 200, h: 100 });
		expect(dragged(box, "se", 20, 30)).toEqual({ x: 100, y: 100, w: 220, h: 130 });
		expect(dragged(box, "nw", 20, 10)).toEqual({ x: 120, y: 110, w: 180, h: 90 });
		expect(dragged(box, "e", -500, 0).w).toBe(8);
		expect(dragged(box, "w", 500, 0)).toMatchObject({ w: 8, x: 292 });
		expect(dragged(box, "n", 0, -40)).toMatchObject({ y: 60, h: 140 });
	});
	it("keeps the shape of a corner drag when asked", () => {
		const r = dragged(box, "se", 100, 0, true);
		expect(r.w / r.h).toBeCloseTo(2, 5);
		const nw = dragged(box, "nw", -100, 0, true);
		expect(nw.w / nw.h).toBeCloseTo(2, 5);
		expect(nw.y + nw.h).toBeCloseTo(200, 5);
	});
});
