// Lays tiles out in rows that each fill the full width, as photo galleries do: a row takes tiles until it is about as
// tall as the tiles want to be, then every tile in it is scaled together so the row ends exactly at the right edge.

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

export function justify(items: JustifyItem[], width: number, gap: number): { boxes: Record<string, Box>; height: number } {
	const boxes: Record<string, Box> = {};
	if (width <= 0 || items.length === 0) return { boxes, height: 0 };

	const rowHeight = (row: JustifyItem[]) => (width - gap * (row.length - 1)) / row.reduce((sum, i) => sum + i.aspect, 0);
	const wanted = (row: JustifyItem[]) => row.reduce((sum, i) => sum + i.height, 0) / row.length;

	const rows: { items: JustifyItem[]; height: number }[] = [];
	let row: JustifyItem[] = [];
	for (const item of items) {
		const next = [...row, item];
		// Once the row would be shorter than its tiles want, it is full
		if (rowHeight(next) <= wanted(next)) {
			// Keep the tile that tipped it over, unless the row was closer to the wanted height without it
			if (row.length > 0 && Math.abs(rowHeight(row) - wanted(row)) < Math.abs(rowHeight(next) - wanted(next))) {
				rows.push({ items: row, height: rowHeight(row) });
				row = [item];
			} else {
				rows.push({ items: next, height: rowHeight(next) });
				row = [];
			}
		} else row = next;
	}
	// The last row is not stretched past a little over what its tiles want, so a lone tile does not become huge
	if (row.length > 0) rows.push({ items: row, height: Math.min(rowHeight(row), wanted(row) * 1.25) });

	let y = 0;
	for (const r of rows) {
		let x = 0;
		for (const item of r.items) {
			const w = item.aspect * r.height;
			boxes[item.id] = { x, y, w, h: r.height };
			x += w + gap;
		}
		y += r.height + gap;
	}
	return { boxes, height: Math.max(0, y - gap) };
}
