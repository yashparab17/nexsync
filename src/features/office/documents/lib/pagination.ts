// Pages for a document that is edited as one flow: where each top-level block would sit, and how far to push it down so that no block
// straddles the gap between two pages. Pure arithmetic, so it can be tested without a browser; `usePagination` applies it to the page.

export interface Measured {
	// Where the block starts and how tall it is, with no pushing applied (pixels from the top of the text)
	top: number;
	height: number;
	// A heading: it stays on the page of the block after it
	keepNext?: boolean;
	// The block starts a page (a page or section break before it)
	breakBefore?: boolean;
	// The first block of a section whose text sits in the middle ("c") or at the bottom ("b") of its page when the section fits on one
	valign?: string;
}

export interface Paginated {
	// How far to push each block down (pixels of extra space above it)
	push: number[];
	pages: number;
}

// `room` is the height of the text on one page; `gap` is everything between the end of the text on one page and the start of the text on
// the next (bottom margin, the space between the sheets, top margin). A block taller than a page is left to run across the gap.
export function paginate(blocks: Measured[], room: number, gap: number): Paginated {
	const stride = room + gap;
	const push: number[] = [];
	let shift = 0;
	let end = 0;
	for (const [i, b] of blocks.entries()) {
		// A heading is moved together with the block that follows it
		const next = blocks[i + 1];
		const height = b.keepNext && next ? Math.min(room, next.top + next.height - b.top) : b.height;
		let y = b.top + shift;
		const page = Math.floor(y / stride);
		const start = page * stride;
		let extra = 0;
		if (b.breakBefore && y - start > 0.5) {
			// A page or section break
			extra = start + stride - y;
		} else if (y - start >= room) {
			// Starts in the gap
			extra = start + stride - y;
		} else if (height <= room && y - start + height > room) {
			// Would run over the end of the page
			extra = start + stride - y;
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
		shift += extra;
		end = Math.max(end, y + b.height);
	}
	return { push, pages: Math.max(1, Math.floor((Math.max(end, 1) - 1) / stride) + 1) };
}
