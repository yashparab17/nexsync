// Pages for a document that is edited as one flow: where each top-level block would sit, and how far to push it down so that no block
// straddles the gap between two pages. Pure arithmetic, so it can be tested without a browser; `usePagination` applies it to the page.

export interface Measured {
	// Where the block starts and how tall it is, with no pushing applied (pixels from the top of the text)
	top: number;
	height: number;
	// A heading: it stays on the page of the block after it
	keepNext?: boolean;
	// How far down the block its first line (or a table's first row) ends: what a heading before it needs on its page
	first?: number;
	// The space after the block, part of its height: like Word, it may hang below the end of the page
	after?: number;
	// The block starts a page (a page or section break before it)
	breakBefore?: boolean;
	// A table: where each row starts and ends, from the top of the table. Like Word, a table that runs over the end of a page goes on
	// on the next from the first row that does not fit.
	rows?: [number, number][];
	// The first block of a section whose text sits in the middle ("c") or at the bottom ("b") of its page when the section fits on one
	valign?: string;
}

export interface Paginated {
	// How far to push each block down (pixels of extra space above it)
	push: number[];
	// For a table broken over two pages: the first row on the next page, and how far it and the rows after it move down
	split: ({ at: number; px: number } | null)[];
	pages: number;
}

// `room` is the height of the text on one page; `gap` is everything between the end of the text on one page and the start of the text on
// the next (bottom margin, the space between the sheets, top margin). A block taller than a page is left to run across the gap.
export function paginate(blocks: Measured[], room: number, gap: number): Paginated {
	const stride = room + gap;
	const push: number[] = [];
	const split: Paginated["split"] = [];
	let shift = 0;
	let end = 0;
	for (const [i, b] of blocks.entries()) {
		// A heading is moved together with the start of the block that follows it (its first line, or first row), as Word keeps it;
		// headings in a row are kept together with the first line after the last of them
		let j = i;
		while (blocks[j].keepNext && j + 1 < blocks.length && j - i < 8) j++;
		const height = j > i ? Math.min(room, blocks[j].top + (blocks[j].first ?? blocks[j].height) - b.top) : b.height;
		let y = b.top + shift;
		const page = Math.floor(y / stride);
		const start = page * stride;
		let extra = 0;
		let cut: { at: number; px: number } | null = null;
		if (b.breakBefore && y - start > 0.5) {
			// A page or section break
			extra = start + stride - y;
		} else if (y - start >= room) {
			// Starts in the gap
			extra = start + stride - y;
		} else if ((height <= room || b.rows) && y - start + height - (j === i ? (b.after ?? 0) : 0) > room) {
			// Would run over the end of the page: a table breaks before its first row that does not fit, anything else moves on whole
			// ponytail: a table is broken once; one longer than two pages runs across the second gap
			const fits = j === i && b.rows ? b.rows.filter(([, bottom]) => y - start + bottom <= room).length : 0;
			if (fits > 0 && fits < b.rows!.length) cut = { at: fits, px: start + stride - (y + b.rows![fits][0]) };
			else if (height <= room) extra = start + stride - y;
		}
		y += extra;
		if (b.valign === "c" || b.valign === "b") {
			// The section runs to the next break; when it fits on the page, its text is moved down to the middle or the bottom
			let j = i + 1;
			while (j < blocks.length && !blocks[j].breakBefore) j++;
			const used = blocks[j - 1].top + blocks[j - 1].height - b.top;
			if (used <= room && y - Math.floor(y / stride) * stride < 0.5) {
				const free = room - used;
				const more = b.valign === "c" ? free / 2 : free;
				extra += more;
				y += more;
			}
		}
		push.push(extra);
		split.push(cut);
		shift += extra + (cut?.px ?? 0);
		end = Math.max(end, y + b.height + (cut?.px ?? 0));
	}
	return { push, split, pages: Math.max(1, Math.floor((Math.max(end, 1) - 1) / stride) + 1) };
}
