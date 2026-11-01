// Lining shapes up: align to the slide or to each other, and spread them evenly. Boxes are the shapes' unrotated boxes in points, as
// the backend draws them; only the boxes that move are returned.

export interface Box {
	id: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

export type AlignTo = "left" | "center" | "right" | "top" | "middle" | "bottom";

const moved = (a: Box, b: Box) => a.x !== b.x || a.y !== b.y;

// One shape lines up with the slide; several with the edge or middle of the whole selection
export function align(boxes: Box[], how: AlignTo, slide: { w: number; h: number }): Box[] {
	if (boxes.length === 0) return [];
	const left = boxes.length === 1 ? 0 : Math.min(...boxes.map((b) => b.x));
	const top = boxes.length === 1 ? 0 : Math.min(...boxes.map((b) => b.y));
	const right = boxes.length === 1 ? slide.w : Math.max(...boxes.map((b) => b.x + b.w));
	const bottom = boxes.length === 1 ? slide.h : Math.max(...boxes.map((b) => b.y + b.h));
	return boxes
		.map((b) => {
			switch (how) {
				case "left":
					return { ...b, x: left };
				case "center":
					return { ...b, x: (left + right - b.w) / 2 };
				case "right":
					return { ...b, x: right - b.w };
				case "top":
					return { ...b, y: top };
				case "middle":
					return { ...b, y: (top + bottom - b.h) / 2 };
				case "bottom":
					return { ...b, y: bottom - b.h };
			}
		})
		.filter((b, i) => moved(b, boxes[i]));
}

// Three or more shapes with the same gap between them; the two outermost stay where they are
export function distribute(boxes: Box[], axis: "h" | "v"): Box[] {
	if (boxes.length < 3) return [];
	const pos = (b: Box) => (axis === "h" ? b.x : b.y);
	const size = (b: Box) => (axis === "h" ? b.w : b.h);
	const sorted = [...boxes].sort((a, b) => pos(a) - pos(b));
	const first = pos(sorted[0]);
	const end = Math.max(...sorted.map((b) => pos(b) + size(b)));
	const gap = (end - first - sorted.reduce((n, b) => n + size(b), 0)) / (sorted.length - 1);
	let at = first;
	const out: Box[] = [];
	for (const b of sorted) {
		const next = axis === "h" ? { ...b, x: at } : { ...b, y: at };
		if (moved(next, b)) out.push(next);
		at += size(b) + gap;
	}
	return out;
}
