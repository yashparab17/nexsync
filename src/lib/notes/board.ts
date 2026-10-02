// The note board: where each note card sits, and what a card shows of its note

import { extractHeadings, type Heading } from "./links";
import type { Point } from "./graph";

export const CARD_W = 260;
export const CARD_H = 176;
const GAP = 32;
const COLUMNS = 4;

// A free spot on the grid for the n-th note
export const gridSlot = (n: number): Point => ({
	x: GAP + (n % COLUMNS) * (CARD_W + GAP),
	y: GAP + Math.floor(n / COLUMNS) * (CARD_H + GAP),
});

// Where every note sits: the place someone dragged it to, or else the next free spot on the grid
export function positionsFor(paths: string[], stored: Record<string, Point>): Record<string, Point> {
	const out: Record<string, Point> = {};
	let slot = 0;
	for (const path of [...paths].sort()) {
		const at = stored[path];
		out[path] = at && Number.isFinite(at.x) && Number.isFinite(at.y) ? at : gridSlot(slot);
		slot++;
	}
	return out;
}

export interface CardSummary {
	snippet: string;
	headings: Heading[]; // the first few, with their level, for the outline on the card
}

// The few words and the headings a card shows. Heading lines are not repeated in the snippet.
export function summarize(text: string, maxHeadings = 5, maxChars = 130): CardSummary {
	const headings = extractHeadings(text).slice(0, maxHeadings);
	const body = text
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !/^#{1,6}\s/.test(line))
		.join(" ");
	const snippet = body.length > maxChars ? body.slice(0, maxChars).trimEnd() + "…" : body;
	return { snippet, headings };
}

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2;
export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
