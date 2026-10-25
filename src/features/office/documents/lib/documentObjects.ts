// Things drawn rather than typed: the number each level of a list shows (1. then a. then i.), shapes, and cropping a picture.

import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// ── list levels ──

const alpha = (n: number) => {
	let s = "";
	for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
	return s;
};

const ROMAN: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
const roman = (n: number) => {
	let s = "";
	let k = n;
	for (const [v, r] of ROMAN) while (k >= v) (s += r), (k -= v);
	return s;
};

// What the nth item of a numbered list shows at a depth: 1. at the top, a. under it, i. under that, then round again
export function listLabel(n: number, depth: number): string {
	const kind = depth % 3;
	return `${kind === 0 ? n : kind === 1 ? alpha(n) : roman(n)}.`;
}

interface Pm {
	type: { name: string };
	childCount: number;
	child: (i: number) => Pm;
	attrs: Record<string, unknown>;
	nodeSize: number;
}

// Draws each numbered item's label by its depth. A list that came from a Word file (it has a list id) keeps the file's own label.
export const listLevelsPlugin = new Plugin({
	props: {
		decorations(state) {
			const out: Decoration[] = [];
			const walk = (group: Pm, start: number, depth: number) => {
				let n = 0;
				let pos = start;
				for (let i = 0; i < group.childCount; i++) {
					const container = group.child(i);
					const content = container.childCount > 0 ? container.child(0) : null;
					if (content?.type.name === "numberedListItem" && !(Number(content.attrs.numId) > 0)) {
						n++;
						out.push(Decoration.node(pos + 1, pos + 1 + content.nodeSize, { "data-nx-label": listLabel(n, depth) }));
					} else n = 0;
					if (container.childCount > 1) walk(container.child(1), pos + 1 + (content?.nodeSize ?? 0) + 1, depth + 1);
					pos += container.nodeSize;
				}
			};
			const top = state.doc as unknown as Pm;
			if (top.childCount > 0) walk(top.child(0), 1, 0);
			return DecorationSet.create(state.doc, out);
		},
	},
});

// ── shapes ──

export type ShapeKind = "rect" | "round" | "ellipse" | "triangle" | "arrow" | "line";

// A shape drawn on a canvas and returned as a PNG picture (a document picture, so it travels in the file)
export function drawShape(kind: ShapeKind, color: string, w = 240, h = 140): string {
	const scale = 2;
	const c = document.createElement("canvas");
	c.width = w * scale;
	c.height = h * scale;
	const g = c.getContext("2d");
	if (!g) return "";
	g.scale(scale, scale);
	g.fillStyle = color;
	g.strokeStyle = "#1f2937";
	g.lineWidth = 3;
	const p = 4;
	g.beginPath();
	if (kind === "rect") g.rect(p, p, w - 2 * p, h - 2 * p);
	else if (kind === "round") g.roundRect(p, p, w - 2 * p, h - 2 * p, 22);
	else if (kind === "ellipse") g.ellipse(w / 2, h / 2, w / 2 - p, h / 2 - p, 0, 0, Math.PI * 2);
	else if (kind === "triangle") (g.moveTo(w / 2, p), g.lineTo(w - p, h - p), g.lineTo(p, h - p), g.closePath());
	else if (kind === "arrow") {
		const neck = h * 0.3;
		g.moveTo(p, h / 2 - neck / 2);
		g.lineTo(w * 0.6, h / 2 - neck / 2);
		g.lineTo(w * 0.6, p);
		g.lineTo(w - p, h / 2);
		g.lineTo(w * 0.6, h - p);
		g.lineTo(w * 0.6, h / 2 + neck / 2);
		g.lineTo(p, h / 2 + neck / 2);
		g.closePath();
	} else (g.moveTo(p, h / 2), g.lineTo(w - p, h / 2));
	if (kind !== "line") g.fill();
	g.stroke();
	return c.toDataURL("image/png");
}

// ── crop ──

export type CropMode = "square" | "wide" | "trim";

// The part of a picture left after cropping: the largest square, or 16:9, from the middle, or the picture less a tenth on each side
export function cropBox(w: number, h: number, mode: CropMode): { x: number; y: number; w: number; h: number } {
	if (mode === "trim") return { x: w * 0.1, y: h * 0.1, w: w * 0.8, h: h * 0.8 };
	const ratio = mode === "square" ? 1 : 16 / 9;
	const cw = Math.min(w, h * ratio);
	const ch = cw / ratio;
	return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
}

// The picture at `url` cropped, as a PNG data address; null when it cannot be read into a canvas
export function cropImage(url: string, mode: CropMode): Promise<string | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => {
			try {
				const b = cropBox(img.naturalWidth, img.naturalHeight, mode);
				const c = document.createElement("canvas");
				c.width = Math.max(1, Math.round(b.w));
				c.height = Math.max(1, Math.round(b.h));
				c.getContext("2d")?.drawImage(img, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height);
				resolve(c.toDataURL("image/png"));
			} catch {
				resolve(null);
			}
		};
		img.onerror = () => resolve(null);
		img.src = url;
	});
}
