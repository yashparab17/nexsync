// jsdom has no layout, so CodeMirror's measuring asks it for rectangles it cannot give. Empty ones are enough for tests.
if (typeof Range !== "undefined") {
	const empty = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
	if (!Range.prototype.getClientRects) Range.prototype.getClientRects = empty;
	if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}
