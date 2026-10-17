// A long document's HTML cut at its top-level elements into pieces that are each quick to turn into blocks, so the editor can be filled a
// piece at a time with the window staying alive in between, instead of freezing while one huge parse runs.

export function chunkHtml(html: string, maxElements = 40, maxChars = 200_000): string[] {
	const body = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
	const out: string[] = [];
	let cur = "";
	let n = 0;
	for (const el of Array.from(body.childNodes)) {
		const text = el.nodeType === 1 ? (el as Element).outerHTML : (el.textContent ?? "").trim() ? `<p>${el.textContent}</p>` : "";
		if (!text) continue;
		if (cur && (n >= maxElements || cur.length + text.length > maxChars)) {
			out.push(cur);
			cur = "";
			n = 0;
		}
		cur += text;
		n++;
	}
	if (cur) out.push(cur);
	return out;
}
