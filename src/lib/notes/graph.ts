// The link graph of the notes: which note points at which, and where to draw each one

import { extractLinks, noteTitle, resolveLink, type NoteRef } from "./links";

export interface NoteInfo extends NoteRef {
	text: string;
}

export interface GraphEdge {
	from: string; // path of the note that has the [[link]]
	to: string; // path of the note it points at
}

// Every [[link]] that points at another existing note, once per pair
export function buildEdges(notes: NoteInfo[]): GraphEdge[] {
	const edges: GraphEdge[] = [];
	const seen = new Set<string>();
	for (const note of notes) {
		for (const target of extractLinks(note.text)) {
			const found = resolveLink(target, notes);
			if (!found || found.path === note.path) continue;
			const key = `${note.path}\n${found.path}`;
			if (seen.has(key)) continue;
			seen.add(key);
			edges.push({ from: note.path, to: found.path });
		}
	}
	return edges;
}

// How many links come in or go out of each note
export function degrees(paths: string[], edges: GraphEdge[]): Map<string, number> {
	const count = new Map(paths.map((p) => [p, 0]));
	for (const e of edges) {
		count.set(e.from, (count.get(e.from) ?? 0) + 1);
		count.set(e.to, (count.get(e.to) ?? 0) + 1);
	}
	return count;
}

export interface Point {
	x: number;
	y: number;
}

// Places the notes with a force layout: every note pushes the others away, links pull their ends together, and a
// weak pull to the middle keeps unlinked notes in view. It starts from a circle and takes a fixed number of steps,
// so the same notes always land in the same places.
export function layoutGraph(paths: string[], edges: GraphEdge[], width: number, height: number, steps = 250): Map<string, Point> {
	const n = paths.length;
	const out = new Map<string, Point>();
	if (n === 0) return out;
	const cx = width / 2;
	const cy = height / 2;
	if (n === 1) return out.set(paths[0], { x: cx, y: cy });

	const index = new Map(paths.map((p, i) => [p, i]));
	const pos = paths.map((_, i) => ({
		x: cx + Math.cos((2 * Math.PI * i) / n) * Math.min(width, height) * 0.35,
		y: cy + Math.sin((2 * Math.PI * i) / n) * Math.min(width, height) * 0.35,
	}));
	const links = edges.flatMap((e) => (index.has(e.from) && index.has(e.to) ? [[index.get(e.from)!, index.get(e.to)!]] : []));
	const k = Math.sqrt((width * height) / n) * 0.8; // the distance notes settle at
	let heat = Math.min(width, height) / 8;

	for (let step = 0; step < steps; step++) {
		const move = pos.map(() => ({ x: 0, y: 0 }));
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				let dx = pos[i].x - pos[j].x;
				let dy = pos[i].y - pos[j].y;
				let d = Math.hypot(dx, dy);
				if (d < 0.01) {
					dx = 0.01 * (i + 1);
					dy = 0.01 * (j + 1);
					d = Math.hypot(dx, dy);
				}
				const push = (k * k) / d;
				move[i].x += (dx / d) * push;
				move[i].y += (dy / d) * push;
				move[j].x -= (dx / d) * push;
				move[j].y -= (dy / d) * push;
			}
		}
		for (const [a, b] of links) {
			const dx = pos[a].x - pos[b].x;
			const dy = pos[a].y - pos[b].y;
			const d = Math.max(Math.hypot(dx, dy), 0.01);
			const pull = (d * d) / k;
			move[a].x -= (dx / d) * pull;
			move[a].y -= (dy / d) * pull;
			move[b].x += (dx / d) * pull;
			move[b].y += (dy / d) * pull;
		}
		for (let i = 0; i < n; i++) {
			move[i].x += (cx - pos[i].x) * 0.05;
			move[i].y += (cy - pos[i].y) * 0.05;
			const size = Math.hypot(move[i].x, move[i].y);
			if (size > 0) {
				const limited = Math.min(size, heat);
				pos[i].x += (move[i].x / size) * limited;
				pos[i].y += (move[i].y / size) * limited;
			}
		}
		heat *= 0.98;
	}

	// Inside the frame, with room for the label
	const pad = 40;
	paths.forEach((p, i) =>
		out.set(p, {
			x: Math.min(Math.max(pos[i].x, pad), Math.max(width - pad, pad)),
			y: Math.min(Math.max(pos[i].y, pad), Math.max(height - pad, pad)),
		}),
	);
	return out;
}

export const graphLabel = (note: NoteRef) => noteTitle(note.name);
