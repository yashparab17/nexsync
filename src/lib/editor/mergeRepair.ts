// Suggesting a fix when a collaborator's edit merges cleanly into yours but leaves the code with syntax errors.
//
// Two edits that are each fine can break code together (one renames a function the other just called, or both
// close the same block). The shared document still converges, so nothing here changes it. Instead, the remote change
// is split into hunks (runs of inserted or removed text), and we look for the largest set of those hunks that can be
// taken without adding errors. Each candidate is a deterministic function of the text and the hunks, and the person
// previews it and chooses; applying it is an ordinary edit, so every device ends up with the same text.
//
// Kept free of imports so the merge study in research/ runs this same code.

// A change to the local text, in the coordinates of that text before the change
export interface Hunk {
	at: number;
	remove: number;
	insert: string;
}

// The shape of the delta a Yjs text event reports
export interface DeltaOp {
	retain?: number;
	insert?: string | object;
	delete?: number;
}

// Hunks from a delta; a removal and an insertion at the same spot are one replacement, since they are one edit
export function hunksFromDelta(delta: DeltaOp[]): Hunk[] {
	const hunks: Hunk[] = [];
	let at = 0;
	let open: Hunk | null = null;
	const close = () => {
		if (open) hunks.push(open);
		open = null;
	};
	for (const op of delta) {
		if (op.retain !== undefined) {
			close();
			at += op.retain;
		} else if (op.delete !== undefined) {
			open ??= { at, remove: 0, insert: "" };
			open.remove += op.delete;
			at += op.delete;
		} else if (typeof op.insert === "string") {
			open ??= { at, remove: 0, insert: "" };
			open.insert += op.insert;
		}
	}
	close();
	return hunks;
}

// The text with only the chosen hunks applied
export function applyHunks(before: string, hunks: Hunk[], keep: boolean[]): string {
	let out = "";
	let cursor = 0;
	hunks.forEach((h, i) => {
		out += before.slice(cursor, h.at);
		out += keep[i] ? h.insert : before.slice(h.at, h.at + h.remove);
		cursor = h.at + h.remove;
	});
	return out + before.slice(cursor);
}

export interface Suggestion {
	text: string;
	keep: boolean[];
	kept: number;
	dropped: number;
	errors: number;
	// How many texts were checked to find it
	tried: number;
}

export interface RepairOptions {
	// Syntax errors in a text, or null when it cannot be checked
	errors: (text: string) => number | null;
	// The most texts to check
	budget?: number;
}

const size = (h: Hunk) => h.remove + h.insert.length;

// The most of the remote change that can be kept without adding syntax errors, or null if none is found.
// Dropping one hunk is tried before two, and so on, and among equals the one that drops the least text goes first.
export function suggestRepair(before: string, hunks: Hunk[], { errors, budget = 300 }: RepairOptions): Suggestion | null {
	const limit = errors(before);
	if (limit === null || hunks.length === 0) return null;
	const n = hunks.length;
	let tried = 0;

	const attempt = (drop: number[]): Suggestion | null => {
		if (tried >= budget) return null;
		tried++;
		const keep = hunks.map((_, i) => !drop.includes(i));
		const text = applyHunks(before, hunks, keep);
		const found = errors(text);
		if (found === null || found > limit) return null;
		return { text, keep, kept: n - drop.length, dropped: drop.length, errors: found, tried };
	};

	const everything = attempt([]);
	if (everything) return null; // Nothing needs repairing

	for (let k = 1; k < n; k++) {
		let best: { suggestion: Suggestion; lost: number } | null = null;
		for (const drop of combinations(n, k)) {
			const suggestion = attempt(drop);
			if (!suggestion) {
				if (tried >= budget) break;
				continue;
			}
			const lost = drop.reduce((sum, i) => sum + size(hunks[i]), 0);
			if (!best || lost < best.lost) best = { suggestion, lost };
		}
		if (best) return { ...best.suggestion, tried };
		if (tried >= budget) return null;
	}
	return null;
}

// Every way to choose k of n indexes, in order
function* combinations(n: number, k: number, start = 0, chosen: number[] = []): Generator<number[]> {
	if (chosen.length === k) {
		yield [...chosen];
		return;
	}
	for (let i = start; i <= n - (k - chosen.length); i++) {
		chosen.push(i);
		yield* combinations(n, k, i + 1, chosen);
		chosen.pop();
	}
}
