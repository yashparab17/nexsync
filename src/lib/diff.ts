// Line diff between two versions of a text, with the changed words marked inside lines that were edited.

export type DiffKind = "same" | "add" | "del";

// A stretch of a line, and whether it is what changed inside that line
export interface Segment {
	text: string;
	changed: boolean;
}

export interface DiffRow {
	kind: DiffKind;
	// 1-based line numbers in the old and new text; a row has the one it belongs to
	oldLine?: number;
	newLine?: number;
	text: string;
	// Only on lines that were edited rather than wholly added or removed
	segments?: Segment[];
}

export interface DiffResult {
	rows: DiffRow[];
	added: number;
	removed: number;
	identical: boolean;
	// Too big to compare line by line; the middle is shown as one removal and one addition
	tooLarge: boolean;
}

// Cells of the comparison table: more than this and the middle is not compared line by line
const MAX_CELLS = 10_000_000;
const MAX_WORD_TOKENS = 400;

export function splitLines(text: string): string[] {
	if (text === "") return [];
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	// A final line break ends the last line; it does not start another one
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

type Op = { kind: DiffKind; a?: number; b?: number };

// The edit script between two lists of keys, found from the longest common subsequence
function script(a: string[], b: string[]): Op[] | null {
	const n = a.length;
	const m = b.length;
	if ((n + 1) * (m + 1) > MAX_CELLS) return null;
	const width = m + 1;
	// lcs[i * width + j] is the length of the common part of a[i..] and b[j..]
	const lcs = new Uint32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
		}
	}
	const ops: Op[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) ops.push({ kind: "same", a: i++, b: j++ });
		else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) ops.push({ kind: "del", a: i++ });
		else ops.push({ kind: "add", b: j++ });
	}
	while (i < n) ops.push({ kind: "del", a: i++ });
	while (j < m) ops.push({ kind: "add", b: j++ });
	return ops;
}

const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

// Marks the words that differ between two versions of one line
export function diffWords(oldLine: string, newLine: string): { old: Segment[]; new: Segment[] } | null {
	const a = oldLine.match(TOKEN) ?? [];
	const b = newLine.match(TOKEN) ?? [];
	if (a.length > MAX_WORD_TOKENS || b.length > MAX_WORD_TOKENS) return null;
	const ops = script(a, b);
	if (!ops) return null;
	const merge = (parts: Segment[]) =>
		parts.reduce<Segment[]>((out, part) => {
			const last = out[out.length - 1];
			if (last && last.changed === part.changed) last.text += part.text;
			else out.push({ ...part });
			return out;
		}, []);
	return {
		old: merge(ops.filter((op) => op.kind !== "add").map((op) => ({ text: a[op.a!], changed: op.kind === "del" }))),
		new: merge(ops.filter((op) => op.kind !== "del").map((op) => ({ text: b[op.b!], changed: op.kind === "add" }))),
	};
}

export function diffLines(oldText: string, newText: string, options: { ignoreWhitespace?: boolean } = {}): DiffResult {
	const oldLines = splitLines(oldText);
	const newLines = splitLines(newText);
	const key = (line: string) => (options.ignoreWhitespace ? line.replace(/\s+/g, " ").trim() : line);
	const oldKeys = oldLines.map(key);
	const newKeys = newLines.map(key);

	// Lines both versions start or end with need no comparing
	let start = 0;
	while (start < oldKeys.length && start < newKeys.length && oldKeys[start] === newKeys[start]) start++;
	let endOld = oldKeys.length;
	let endNew = newKeys.length;
	while (endOld > start && endNew > start && oldKeys[endOld - 1] === newKeys[endNew - 1]) {
		endOld--;
		endNew--;
	}

	let tooLarge = false;
	let middle = script(oldKeys.slice(start, endOld), newKeys.slice(start, endNew));
	if (!middle) {
		tooLarge = true;
		middle = [
			...Array.from({ length: endOld - start }, (_, k) => ({ kind: "del" as const, a: k })),
			...Array.from({ length: endNew - start }, (_, k) => ({ kind: "add" as const, b: k })),
		];
	}
	const ops: Op[] = [
		...Array.from({ length: start }, (_, k) => ({ kind: "same" as const, a: k, b: k })),
		...middle.map((op) => ({ ...op, a: op.a === undefined ? undefined : op.a + start, b: op.b === undefined ? undefined : op.b + start })),
		...Array.from({ length: oldKeys.length - endOld }, (_, k) => ({ kind: "same" as const, a: endOld + k, b: endNew + k })),
	];

	const rows: DiffRow[] = [];
	let added = 0;
	let removed = 0;
	for (let i = 0; i < ops.length; ) {
		const op = ops[i];
		if (op.kind === "same") {
			rows.push({ kind: "same", oldLine: op.a! + 1, newLine: op.b! + 1, text: newLines[op.b!] });
			i++;
			continue;
		}
		// A run of removals followed by additions is an edit: pair the lines up to mark their words
		let d = i;
		while (d < ops.length && ops[d].kind === "del") d++;
		let e = d;
		while (e < ops.length && ops[e].kind === "add") e++;
		const dels = ops.slice(i, d);
		const adds = ops.slice(d, e);
		const delRows: DiffRow[] = dels.map((o) => ({ kind: "del", oldLine: o.a! + 1, text: oldLines[o.a!] }));
		const addRows: DiffRow[] = adds.map((o) => ({ kind: "add", newLine: o.b! + 1, text: newLines[o.b!] }));
		for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
			const words = diffWords(delRows[k].text, addRows[k].text);
			if (words) {
				delRows[k].segments = words.old;
				addRows[k].segments = words.new;
			}
		}
		rows.push(...delRows, ...addRows);
		removed += dels.length;
		added += adds.length;
		i = e;
	}
	return { rows, added, removed, identical: added === 0 && removed === 0, tooLarge };
}
