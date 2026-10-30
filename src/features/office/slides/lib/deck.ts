// A slide deck as a shared document, in pieces people can change at the same time: the deck's base (everything but the slides, one JSON
// text), the order of the slides, and for each slide its own settings and each of its shapes. A shape is itself in pieces: what it is
// (one JSON text), where it is and how big (x, y, w, h and rot, each its own value) and its text. Two people moving different shapes
// both keep their moves, and so do two people changing different things of the same shape (one moves it while the other edits its text);
// two people changing the same thing of a shape keep the later change (RESEARCH.md §8q: stored whole, 11% to 19% of such edits were lost).
// The backend turns the pieces into a picture or a file.

import * as Y from "yjs";

export interface Xfrm {
	x: number;
	y: number;
	w: number;
	h: number;
	rot?: number;
}

// A shape as the model writes it; only what the editor reads is named
export interface ShapeJson {
	id: number;
	name?: string;
	xfrm?: Xfrm | null;
	ph?: unknown;
	text?: { paragraphs: { runs: { text: string }[] }[] } | null;
	[extra: string]: unknown;
}

export interface SlideJson {
	id: number;
	layout: number;
	shapes: ShapeJson[];
	[extra: string]: unknown;
}

export interface Frame {
	id: number;
	name: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rot: number;
	kind: string;
	placeholder: boolean;
}

export const keyId = () => Math.random().toString(36).slice(2, 10);

const meta = (doc: Y.Doc) => doc.getMap<string>("deck");
export const slideOrder = (doc: Y.Doc) => doc.getArray<string>("slides");
const slideMap = (doc: Y.Doc, key: string) => doc.getMap<unknown>(`slide:${key}`);
const shapeOrder = (doc: Y.Doc, key: string) => doc.getArray<number>(`shapes:${key}`);

// The pieces of a shape in a slide's map: what it is (`s:`), the five numbers of its box (`g:`), its text (`t:`)
const GEO = ["x", "y", "w", "h", "rot"] as const;
const baseKey = (id: number) => `s:${id}`;
const geoKey = (id: number, f: string) => `g:${id}:${f}`;
const textKey = (id: number) => `t:${id}`;

// A shape from its pieces. A document saved before shapes were in pieces has the box and the text inside `s:`; a piece, where there
// is one, wins over that.
function readShape(map: Y.Map<unknown>, id: number): ShapeJson | null {
	const raw = map.get(baseKey(id));
	if (typeof raw !== "string") return null;
	const shape = JSON.parse(raw) as ShapeJson;
	let box: Xfrm | undefined = shape.xfrm ? { ...shape.xfrm } : undefined;
	for (const f of GEO) {
		const v = map.get(geoKey(id, f));
		if (typeof v === "number") (box ??= { x: 0, y: 0, w: 0, h: 0 })[f] = v;
	}
	if (box) shape.xfrm = box;
	const t = map.get(textKey(id));
	if (typeof t === "string") shape.text = JSON.parse(t) as ShapeJson["text"];
	return shape;
}

// Writes a shape, only the pieces that differ from what is there, so that a piece somebody else changed meanwhile is not written over.
// A shape with no pieces yet (new, or saved the old way) gets all of them.
function putShape(map: Y.Map<unknown>, shape: ShapeJson) {
	const id = shape.id;
	const { xfrm, text, ...rest } = shape;
	// What is not a box or a text stays in `s:`; a box or text that is null stays there as null, so the model still sees it
	const base = JSON.stringify({ ...rest, ...(xfrm ? {} : { xfrm }), ...(text ? {} : { text }) });
	if (map.get(baseKey(id)) !== base) map.set(baseKey(id), base);
	for (const f of GEO) {
		const v = xfrm?.[f];
		if (v === undefined) map.delete(geoKey(id, f));
		else if (map.get(geoKey(id, f)) !== v) map.set(geoKey(id, f), v);
	}
	if (text) {
		const t = JSON.stringify(text);
		if (map.get(textKey(id)) !== t) map.set(textKey(id), t);
	} else map.delete(textKey(id));
}

function dropShape(map: Y.Map<unknown>, id: number) {
	map.delete(baseKey(id));
	map.delete(textKey(id));
	for (const f of GEO) map.delete(geoKey(id, f));
}

export const getBase = (doc: Y.Doc): string | null => meta(doc).get("base") ?? null;
// A new base after something was added to it (a picture)
export const setBase = (doc: Y.Doc, base: string) => meta(doc).set("base", base);

// A slide's own settings (everything but its shapes), changed whole: notes, transition, background, hidden
export function setSlideMeta(doc: Y.Doc, key: string, slide: SlideJson) {
	const { shapes: _shapes, ...rest } = slide; // eslint-disable-line @typescript-eslint/no-unused-vars
	slideMap(doc, key).set("meta", JSON.stringify(rest));
}

export const notesOf = (s: SlideJson): string => textOf({ id: 0, text: s.notes as ShapeJson["text"] });
export const transitionOf = (s: SlideJson): string => (s.transition as { kind?: string } | null | undefined)?.kind ?? "none";
export const slideKeys = (doc: Y.Doc): string[] => slideOrder(doc).toArray();

function writeSlide(doc: Y.Doc, key: string, slide: SlideJson) {
	const { shapes, ...rest } = slide;
	const map = slideMap(doc, key);
	map.set("meta", JSON.stringify(rest));
	const order = shapeOrder(doc, key);
	if (order.length > 0) order.delete(0, order.length);
	order.push(shapes.map((s) => s.id));
	for (const s of shapes) putShape(map, s);
}

// Fills an empty document from a deck read from a file; does nothing when it already has slides
export function seed(doc: Y.Doc, base: string, slides: string[]): boolean {
	if (slideOrder(doc).length > 0 || getBase(doc)) return false;
	doc.transact(() => {
		meta(doc).set("base", base);
		const keys = slides.map((s) => {
			const key = keyId();
			writeSlide(doc, key, JSON.parse(s) as SlideJson);
			return key;
		});
		slideOrder(doc).push(keys);
	});
	return true;
}

// A slide whole again, from its pieces
export function readSlide(doc: Y.Doc, key: string): SlideJson | null {
	const map = slideMap(doc, key);
	const m = map.get("meta");
	if (typeof m !== "string") return null;
	const shapes: ShapeJson[] = [];
	const ids = shapeOrder(doc, key).toArray();
	// Two people who changed the order of one shape at once leave its id twice; it is drawn once, at the later place
	const lastAt = new Map(ids.map((id, i) => [id, i]));
	ids.forEach((id, i) => {
		if (lastAt.get(id) !== i) return;
		const shape = readShape(map, id);
		if (shape) shapes.push(shape);
	});
	return { ...(JSON.parse(m) as SlideJson), shapes };
}

export const readSlides = (doc: Y.Doc): string[] => slideKeys(doc).map((k) => readSlide(doc, k)).filter((s): s is SlideJson => !!s).map((s) => JSON.stringify(s));

export function setShape(doc: Y.Doc, key: string, shape: ShapeJson) {
	doc.transact(() => putShape(slideMap(doc, key), shape));
}

export function addShape(doc: Y.Doc, key: string, shape: ShapeJson) {
	doc.transact(() => {
		setShape(doc, key, shape);
		shapeOrder(doc, key).push([shape.id]);
	});
}

export function removeShape(doc: Y.Doc, key: string, id: number) {
	doc.transact(() => {
		const order = shapeOrder(doc, key);
		const at = order.toArray().indexOf(id);
		if (at >= 0) order.delete(at, 1);
		dropShape(slideMap(doc, key), id);
	});
}

// Moves a shape to the front, the back, or one step either way (the later in the list, the nearer the front)
export function arrange(doc: Y.Doc, key: string, id: number, to: "front" | "back" | "forward" | "backward") {
	doc.transact(() => {
		const order = shapeOrder(doc, key);
		const list = order.toArray();
		const at = list.indexOf(id);
		if (at < 0) return;
		const target = to === "front" ? list.length - 1 : to === "back" ? 0 : Math.max(0, Math.min(list.length - 1, at + (to === "forward" ? 1 : -1)));
		if (target === at) return;
		order.delete(at, 1);
		order.insert(target, [id]);
	});
}

export function nextShapeId(slide: SlideJson): number {
	return slide.shapes.reduce((m, s) => Math.max(m, s.id), slide.id) + 1;
}

// Adds a slide after another (or at the end) and returns its key
export function addSlide(doc: Y.Doc, slide: SlideJson, after?: string): string {
	const key = keyId();
	doc.transact(() => {
		writeSlide(doc, key, slide);
		const at = after ? slideKeys(doc).indexOf(after) + 1 : slideOrder(doc).length;
		slideOrder(doc).insert(at, [key]);
	});
	return key;
}

export function duplicateSlide(doc: Y.Doc, key: string): string | null {
	const s = readSlide(doc, key);
	return s ? addSlide(doc, s, key) : null;
}

export function deleteSlide(doc: Y.Doc, key: string): string | null {
	const keys = slideKeys(doc);
	if (keys.length <= 1) return "A deck keeps at least one slide.";
	const at = keys.indexOf(key);
	if (at >= 0) slideOrder(doc).delete(at, 1);
	return null;
}

export function moveSlide(doc: Y.Doc, key: string, by: number) {
	doc.transact(() => {
		const keys = slideKeys(doc);
		const at = keys.indexOf(key);
		const to = Math.max(0, Math.min(keys.length - 1, at + by));
		if (at < 0 || to === at) return;
		slideOrder(doc).delete(at, 1);
		slideOrder(doc).insert(to, [key]);
	});
}

// The text of a shape, paragraphs joined by line breaks
export const textOf = (s: ShapeJson): string => (s.text?.paragraphs ?? []).map((p) => p.runs.map((r) => r.text).join("")).join("\n");

// A frame moved or resized by a drag: the box before, the handle, and how far the pointer went (in points)
export type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export function dragged(box: Xfrm, handle: Handle, dx: number, dy: number, keepRatio = false): Xfrm {
	const min = 8;
	if (handle === "move") return { ...box, x: box.x + dx, y: box.y + dy };
	let { x, y, w, h } = box;
	if (handle.includes("e")) w = Math.max(min, box.w + dx);
	if (handle.includes("s")) h = Math.max(min, box.h + dy);
	if (handle.includes("w")) {
		w = Math.max(min, box.w - dx);
		x = box.x + box.w - w;
	}
	if (handle.includes("n")) {
		h = Math.max(min, box.h - dy);
		y = box.y + box.h - h;
	}
	if (keepRatio && handle.length === 2 && box.h > 0) {
		const ratio = box.w / box.h;
		const nh = w / ratio;
		if (handle.includes("n")) y = box.y + box.h - nh;
		h = nh;
	}
	return { ...box, x, y, w, h };
}
