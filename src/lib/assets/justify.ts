// Lays tiles out in rows that each fill the full width, as photo galleries do. Where the rows break is chosen for the
// whole set at once (the way a text editor breaks lines), so every row is as close as it can be to the height its tiles
// want, and no row is stretched past MAX_STRETCH times that. A row that cannot fill the width within that limit is
// centred instead of stretched.

export interface JustifyItem {
	id: string;
	// Width divided by height
	aspect: number;
	// How tall the tile would like to be, before it is stretched
	height: number;
}

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export const MAX_STRETCH = 1.3;
const MIN_SHRINK = 0.6;
const MAX_ROW = 12;

export function justify(items: JustifyItem[], width: number, gap: number): { boxes: Record<string, Box>; height: number } {
	const boxes: Record<string, Box> = {};
	const n = items.length;
	if (width <= 0 || n === 0) return { boxes, height: 0 };

	// The height a row of items[from, to) would have if it filled the width, with the tallest and shortest height its
	// tiles want. A row's tiles all share its height, so each is stretched by that height over its own wanted one.
	const fill = (from: number, to: number) => {
		let aspects = 0;
		let tallest = 0;
		let shortest = Infinity;
		for (let k = from; k < to; k++) {
			aspects += items[k].aspect;
			tallest = Math.max(tallest, items[k].height);
			shortest = Math.min(shortest, items[k].height);
		}
		return { height: (width - gap * (to - from - 1)) / aspects, tallest, shortest };
	};

	// How bad a row is: how far its tiles are from their wanted heights, on a log scale so too tall and too short count
	// the same, and a steep penalty when any tile is stretched past the limit or shrunk too far
	const cost = (from: number, to: number, last: boolean) => {
		const { height, tallest, shortest } = fill(from, to);
		if (last && height > shortest) return 0;
		let off = 0;
		for (let k = from; k < to; k++) off += Math.log(height / items[k].height) ** 2;
		const over = Math.max(0, height / shortest - MAX_STRETCH) + Math.max(0, MIN_SHRINK - height / tallest);
		return off / (to - from) + over * 50;
	};

	// best[j]: the cheapest way to lay out the first j items; from[j]: where the last row of that layout starts
	const best = new Array<number>(n + 1).fill(Infinity);
	const from = new Array<number>(n + 1).fill(0);
	best[0] = 0;
	for (let j = 1; j <= n; j++) {
		for (let i = Math.max(0, j - MAX_ROW); i < j; i++) {
			const c = best[i] + cost(i, j, j === n);
			if (c < best[j]) {
				best[j] = c;
				from[j] = i;
			}
		}
	}

	const rows: [number, number][] = [];
	for (let j = n; j > 0; j = from[j]) rows.unshift([from[j], j]);

	let y = 0;
	for (const [start, end] of rows) {
		const { height, shortest } = fill(start, end);
		// Never stretched past the limit; a row held back this way is centred
		const h = Math.min(height, shortest * MAX_STRETCH);
		const rowWidth = items.slice(start, end).reduce((sum, it) => sum + it.aspect * h, 0) + gap * (end - start - 1);
		let x = Math.max(0, (width - rowWidth) / 2);
		for (let k = start; k < end; k++) {
			const w = items[k].aspect * h;
			boxes[items[k].id] = { x, y, w, h };
			x += w + gap;
		}
		y += h + gap;
	}
	return { boxes, height: Math.max(0, y - gap) };
}
