// Line numbers for the page: how many lines each block of text fills, counted from its height and line height, and where each line sits

export interface LineMark {
	n: number;
	top: number;
}

// `scale` is the page zoom as a fraction, since measured positions are zoomed and the marks are placed in unzoomed pixels
export function lineMarks(page: HTMLElement, scale: number): LineMark[] {
	const origin = page.getBoundingClientRect().top;
	const marks: LineMark[] = [];
	let n = 0;
	for (const el of page.querySelectorAll<HTMLElement>(".bn-block-content")) {
		// Only blocks of text: a table or a picture has no lines to count, and a block holding blocks is counted through its children
		const type = el.getAttribute("data-content-type");
		if (!type || type === "table" || type === "image" || el.querySelector(".bn-block-content")) continue;
		const text = el.querySelector<HTMLElement>(".bn-inline-content") ?? el;
		if (!(text.textContent ?? "").trim()) continue;
		const rect = text.getBoundingClientRect();
		const lh = parseFloat(getComputedStyle(text).lineHeight);
		if (!Number.isFinite(lh) || lh <= 0 || rect.height <= 0) continue;
		const lines = Math.max(1, Math.round(rect.height / scale / lh));
		for (let i = 0; i < lines; i++) marks.push({ n: ++n, top: (rect.top - origin) / scale + i * lh });
	}
	return marks;
}
