// Fuzzy matching for the quick open and command lists: every typed letter must appear in order, and tighter matches
// that start words (or path segments) rank higher.

export interface FuzzyMatch {
	score: number;
	// Positions in the text that matched, for highlighting
	indexes: number[];
}

const SEPARATORS = new Set(["/", "\\", " ", "-", "_", ".", ":"]);

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
	const q = query.trim().toLowerCase();
	if (!q) return { score: 0, indexes: [] };
	const t = text.toLowerCase();
	const indexes: number[] = [];
	let score = 0;
	let from = 0;
	let previous = -2;
	for (const ch of q) {
		if (ch === " ") continue;
		const at = t.indexOf(ch, from);
		if (at === -1) return null;
		indexes.push(at);
		// Letters that follow each other, and letters that start a word or a path segment, are worth more
		if (at === previous + 1) score += 8;
		if (at === 0 || SEPARATORS.has(t[at - 1])) score += 6;
		else if (text[at] !== t[at] && text[at - 1] === t[at - 1]) score += 4;
		score += 1;
		previous = at;
		from = at + 1;
	}
	// The name of a file matters more than its folders, and short texts beat long ones that match the same letters
	const lastSeparator = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\"));
	if (indexes[0] > lastSeparator) score += 10;
	score -= Math.min(10, Math.floor(t.length / 20));
	score -= Math.floor((indexes[indexes.length - 1] - indexes[0] - (indexes.length - 1)) / 4);
	return { score, indexes };
}

// Items that match, best first; with nothing typed the list keeps its own order
export function fuzzyFilter<T>(items: T[], query: string, text: (item: T) => string, limit = 100): { item: T; match: FuzzyMatch }[] {
	if (!query.trim()) return items.slice(0, limit).map((item) => ({ item, match: { score: 0, indexes: [] } }));
	const found: { item: T; match: FuzzyMatch }[] = [];
	for (const item of items) {
		const match = fuzzyMatch(query, text(item));
		if (match) found.push({ item, match });
	}
	return found.sort((a, b) => b.match.score - a.match.score).slice(0, limit);
}
