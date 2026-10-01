// How often does merging two correct edits with a CRDT leave code that does not parse, and how often can
// the repair suggestion in src/lib/editor/mergeRepair.ts fix it?
//
// For each file in the corpus: two simulated people start from the same text, each make one to three small
// edits that leave the file valid on its own, then exchange Yjs updates. If the merged text has syntax errors,
// it was broken by the merge and nothing else. A three-way textual merge (`git merge-file`) is run on a sample of
// the same cases for comparison. Run it with:  pnpm study   (TRIALS=40 pnpm study to set the attempts per file)
//
// The corpus is this repository's own source, and the edits are generated, not taken from real histories (see
// the limitations in results.md).

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { cssLanguage } from "@codemirror/lang-css";
import { tsxLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { jsonLanguage } from "@codemirror/lang-json";
import { rustLanguage } from "@codemirror/lang-rust";
import * as Y from "yjs";

import { applyHunks, hunksFromDelta, suggestRepair, type DeltaOp } from "../../src/lib/editor/mergeRepair.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const TRIALS_PER_FILE = Number(process.env.TRIALS ?? process.argv[2] ?? 40);
const DIFF3_EVERY = 8; // Run the three-way merge on one case in this many

// ── parsing ──
type Lang = "ts" | "tsx" | "rust" | "json" | "css";
// The same grammars the editor uses to underline syntax errors
const parsers = {
	ts: typescriptLanguage.parser,
	tsx: tsxLanguage.parser,
	rust: rustLanguage.parser,
	json: jsonLanguage.parser,
	css: cssLanguage.parser,
};
const LANG_OF: Record<string, Lang> = { ".ts": "ts", ".tsx": "tsx", ".rs": "rust", ".json": "json", ".css": "css" };

function errorCount(text: string, lang: Lang): number {
	let errors = 0;
	parsers[lang].parse(text).iterate({
		enter(node) {
			if (node.type.isError) errors++;
		},
	});
	return errors;
}

// ── corpus ──
function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === "target" || name === "dist" || name.startsWith(".") || name === "gen") continue;
		const path = join(dir, name);
		const info = statSync(path);
		if (info.isDirectory()) walk(path, out);
		else if (extname(name) in LANG_OF && info.size >= 800 && info.size <= 120_000) out.push(path);
	}
	return out;
}

// ── randomness ──
function mulberry32(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
type Rng = () => number;
const pick = <T>(rng: Rng, xs: T[]): T => xs[Math.floor(rng() * xs.length)];
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

// ── edits ──
const KEYWORDS = new Set("function const let var return if else for while class import export from default new this async await type interface extends implements fn pub use mod struct enum impl match self Self true false null undefined".split(" "));

function lineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
	return starts;
}

// A line near `target` with something matching `pattern` in it
function findNear(text: string, target: number, pattern: RegExp): { from: number; match: string } | null {
	const starts = lineStarts(text);
	for (let d = 0; d <= 12; d++) {
		for (const line of d === 0 ? [target] : [target + d, target - d]) {
			if (line < 0 || line >= starts.length) continue;
			const from = starts[line];
			const to = line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
			const re = new RegExp(pattern.source, "g");
			const hits = [...text.slice(from, to).matchAll(re)].filter((m) => !KEYWORDS.has(m[0]));
			if (hits.length) {
				const h = hits[Math.floor(hits.length / 2)];
				return { from: from + (h.index ?? 0), match: h[0] };
			}
		}
	}
	return null;
}

function editOnce(text: string, lang: Lang, target: number, rng: Rng): string | null {
	const starts = lineStarts(text);
	const line = Math.min(Math.max(target, 0), starts.length - 1);
	const lineStart = starts[line];
	const lineEnd = line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
	const indent = /^\s*/.exec(text.slice(lineStart, lineEnd))?.[0] ?? "";
	const comment = lang === "css" ? "/* note */" : "// note";
	const statement = lang === "rust" ? "let _n = 0;" : "const __n = 0;";
	const kind = pick(rng, [
		"rename", "rename", "literal", "literal", "insert", "insert", "insert", "delete", "delete", "dup", "comment", "comment",
		"blockdelete", "blockdelete", "wrap", "wrap", "move", "move",
	]);
	const all = text.split("\n");

	if (kind === "rename") {
		const hit = findNear(text, line, /\b[A-Za-z_][A-Za-z0-9_]{2,}\b/);
		return hit ? text.slice(0, hit.from) + hit.match + "X" + text.slice(hit.from + hit.match.length) : null;
	}
	if (kind === "literal") {
		const hit = findNear(text, line, /\b\d+\b/);
		return hit ? text.slice(0, hit.from) + String(Number(hit.match) + 1) + text.slice(hit.from + hit.match.length) : null;
	}
	// Structural edits: the kind of change a refactoring makes
	if (kind === "blockdelete") {
		// From a line that opens a block to the line that closes it
		for (let l = line; l < Math.min(all.length, line + 12); l++) {
			if (!all[l].trimEnd().endsWith("{")) continue;
			let depth = 0;
			for (let m = l; m < all.length; m++) {
				depth += (all[m].match(/\{/g) ?? []).length - (all[m].match(/\}/g) ?? []).length;
				if (depth <= 0) return [...all.slice(0, l), ...all.slice(m + 1)].join("\n");
			}
			return null;
		}
		return null;
	}
	if (kind === "wrap") {
		if (lang === "json" || lang === "css") return null;
		const end = Math.min(all.length, line + int(rng, 1, 4));
		return [...all.slice(0, line), indent + "{", ...all.slice(line, end), indent + "}", ...all.slice(end)].join("\n");
	}
	if (kind === "move") {
		const to = line + pick(rng, [-8, -5, -3, 3, 5, 8]);
		if (to < 0 || to >= all.length || all[line].trim() === "") return null;
		const rest = [...all.slice(0, line), ...all.slice(line + 1)];
		return [...rest.slice(0, to), all[line], ...rest.slice(to)].join("\n");
	}
	if (lang === "json" && (kind === "insert" || kind === "comment")) return null;
	if (kind === "insert") return text.slice(0, lineStart) + indent + statement + "\n" + text.slice(lineStart);
	if (kind === "comment") return text.slice(0, lineStart) + indent + comment + "\n" + text.slice(lineStart);
	if (kind === "delete") return text.slice(0, lineStart) + text.slice(Math.min(lineEnd + 1, text.length));
	return text.slice(0, lineEnd) + "\n" + text.slice(lineStart, lineEnd) + text.slice(lineEnd);
}

// An edit that leaves the file valid by itself, found by trying a few
function validEdit(text: string, lang: Lang, target: number, rng: Rng): { text: string; line: number } | null {
	for (let i = 0; i < 25; i++) {
		const line = Math.max(0, target + (i === 0 ? 0 : int(rng, -3, 3)));
		const next = editOnce(text, lang, line, rng);
		if (next !== null && next !== text && errorCount(next, lang) === 0) return { text: next, line };
	}
	return null;
}

// The smallest replacement that turns `before` into `after`, as Yjs operations
function applyTo(ytext: Y.Text, before: string, after: string) {
	let a = 0;
	while (a < before.length && a < after.length && before[a] === after[a]) a++;
	let b = 0;
	while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
	if (before.length - a - b > 0) ytext.delete(a, before.length - a - b);
	if (after.length - a - b > 0) ytext.insert(a, after.slice(a, after.length - b));
}

// ── one trial ──
const BUCKETS = ["same line", "1-3 lines apart", "4-20 lines apart", "more than 20 apart"] as const;
type Bucket = (typeof BUCKETS)[number];
const bucketOf = (d: number): Bucket => (d === 0 ? BUCKETS[0] : d <= 3 ? BUCKETS[1] : d <= 20 ? BUCKETS[2] : BUCKETS[3]);

interface Outcome {
	lang: Lang;
	bucket: Bucket;
	broken: boolean;
	diverged: boolean;
	repaired: "none-needed" | "partial" | "no-fix";
	tried: number;
	hunks: number;
	diff3?: "clean-valid" | "clean-broken" | "conflict";
}

function makeUser(baseUpdate: Uint8Array, base: string, lang: Lang, target: number, rng: Rng) {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, baseUpdate);
	const ytext = doc.getText("t");
	let text = base;
	let firstLine = -1;
	for (let n = int(rng, 1, 3); n > 0; n--) {
		const edit = validEdit(text, lang, target + int(rng, -2, 2), rng);
		if (!edit) break;
		if (firstLine < 0) firstLine = edit.line;
		applyTo(ytext, text, edit.text);
		text = edit.text;
	}
	return { doc, ytext, text, firstLine };
}

function trial(base: string, lang: Lang, rng: Rng, index: number): Outcome | null {
	const seed = new Y.Doc();
	seed.getText("t").insert(0, base);
	const baseUpdate = Y.encodeStateAsUpdate(seed);
	const lines = lineStarts(base).length;

	const first = makeUser(baseUpdate, base, lang, int(rng, 0, lines - 1), rng);
	if (first.firstLine < 0) return null;
	const offset = pick(rng, [0, int(rng, 1, 3), int(rng, 4, 20), int(rng, 21, 400)]) * (rng() < 0.5 ? -1 : 1);
	const second = makeUser(baseUpdate, base, lang, Math.min(Math.max(first.firstLine + offset, 0), lines - 1), rng);
	if (second.firstLine < 0) return null;
	const distance = Math.abs(first.firstLine - second.firstLine);

	// The first person receives the second person's changes
	let delta: DeltaOp[] = [];
	first.ytext.observe((event) => {
		delta = event.changes.delta as DeltaOp[];
	});
	const before = first.ytext.toString();
	Y.applyUpdate(first.doc, Y.encodeStateAsUpdate(second.doc, Y.encodeStateVector(first.doc)));
	Y.applyUpdate(second.doc, Y.encodeStateAsUpdate(first.doc, Y.encodeStateVector(second.doc)));
	const merged = first.ytext.toString();

	const out: Outcome = {
		lang,
		bucket: bucketOf(distance),
		broken: errorCount(merged, lang) > 0,
		diverged: merged !== second.ytext.toString(),
		repaired: "none-needed",
		tried: 0,
		hunks: 0,
	};

	if (out.broken) {
		const hunks = hunksFromDelta(delta);
		const fix = suggestRepair(before, hunks, { errors: (t) => errorCount(t, lang) });
		out.hunks = hunks.length;
		out.repaired = fix ? "partial" : "no-fix";
		out.tried = fix?.tried ?? 0;
		// A fix must be a text that parses and keeps some of the other person's change; the hunks must also rebuild the merge
		if (fix && (errorCount(fix.text, lang) > 0 || fix.text === before || applyHunks(before, hunks, hunks.map(() => true)) !== merged)) {
			out.repaired = "no-fix";
		}
	}

	if (index % DIFF3_EVERY === 0) out.diff3 = threeWay(base, first.text, second.text, lang);
	return out;
}

const scratch = mkdtempSync(join(tmpdir(), "merge-study-"));
function threeWay(base: string, a: string, b: string, lang: Lang): Outcome["diff3"] {
	writeFileSync(join(scratch, "base"), base);
	writeFileSync(join(scratch, "a"), a);
	writeFileSync(join(scratch, "b"), b);
	const run = spawnSync("git", ["merge-file", "-p", join(scratch, "a"), join(scratch, "base"), join(scratch, "b")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (run.status !== 0) return "conflict";
	return errorCount(run.stdout, lang) > 0 ? "clean-broken" : "clean-valid";
}

// ── run ──
const files = walk(join(root, "src")).concat(walk(join(root, "src-tauri", "src")), [join(root, "package.json"), join(root, "src-tauri", "tauri.conf.json")]);
const rng = mulberry32(2026);
const rows: Outcome[] = [];
let used = 0;
const started = Date.now();
for (const file of files) {
	const lang = LANG_OF[extname(file)];
	const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
	if (errorCount(text, lang) !== 0) continue; // The corpus is files that parse
	used++;
	for (let i = 0; i < TRIALS_PER_FILE; i++) {
		const outcome = trial(text, lang, rng, rows.length);
		if (outcome) rows.push(outcome);
	}
}

// ── report ──
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");
function table(title: string, keyOf: (o: Outcome) => string, keys: string[]): string {
	let md = `### ${title}\n\n| | merges | broken by the merge | of those, fixed by keeping part of the change | no fix found |\n|---|---:|---:|---:|---:|\n`;
	for (const key of keys) {
		const r = rows.filter((o) => keyOf(o) === key);
		const broken = r.filter((o) => o.broken);
		const fixed = broken.filter((o) => o.repaired === "partial").length;
		md += `| ${key} | ${r.length} | ${broken.length} (${pct(broken.length, r.length)}) | ${fixed} (${pct(fixed, broken.length)}) | ${broken.length - fixed} |\n`;
	}
	return md + "\n";
}

const broken = rows.filter((o) => o.broken);
const fixed = broken.filter((o) => o.repaired === "partial");
const sampled = rows.filter((o) => o.diff3);
const diff3 = (k: NonNullable<Outcome["diff3"]>) => sampled.filter((o) => o.diff3 === k).length;
const both = sampled.filter((o) => o.diff3 === "clean-broken");
const avgTried = fixed.length ? (fixed.reduce((s, o) => s + o.tried, 0) / fixed.length).toFixed(1) : "n/a";

const md = `# Merge study results

Generated ${new Date().toISOString()} by \`research/merge-study/run.ts\`. ${rows.length} merges over ${used} files from this repository, ${TRIALS_PER_FILE} attempts per file.

Each merge: two simulated people edit the same file offline (one to three small edits each: rename an identifier, change a number, insert, delete, duplicate or move a line, add a comment, delete a whole block, or wrap lines in a block), every edit leaving the file valid on its own, then exchange Yjs updates. "Broken" means the merged text has syntax errors under the Lezer grammar of its language although both inputs had none.

## Headline

- Merges that diverged between the two devices: **${rows.filter((o) => o.diverged).length}** of ${rows.length}.
- Merges the CRDT completed without complaint but left broken code: **${broken.length}** of ${rows.length} (**${pct(broken.length, rows.length)}**).
- Of those, a part of the other person's change could be kept without adding errors in **${fixed.length}** (**${pct(fixed.length, broken.length)}**), after checking ${avgTried} candidate texts on average.
- On a sample of ${sampled.length} of the same cases, a three-way textual merge (\`git merge-file\`) reported a conflict in ${diff3("conflict")} (${pct(diff3("conflict"), sampled.length)}), merged cleanly and validly in ${diff3("clean-valid")} (${pct(diff3("clean-valid"), sampled.length)}), and merged cleanly but left broken code in ${both.length} (${pct(both.length, sampled.length)}).

### The CRDT result against the three-way merge, on the sampled cases

| three-way merge says | cases | CRDT merge valid | CRDT merge broken |
|---|---:|---:|---:|
${(["conflict", "clean-valid", "clean-broken"] as const).map((k) => { const r = sampled.filter((o) => o.diff3 === k); const b = r.filter((o) => o.broken).length; return `| ${k} | ${r.length} | ${r.length - b} (${pct(r.length - b, r.length)}) | ${b} (${pct(b, r.length)}) |`; }).join("\n")}

${table("By language", (o) => o.lang, ["ts", "tsx", "rust", "json", "css"])}${table("By how close the two edits were", (o) => o.bucket, [...BUCKETS])}
## Limitations

- The edits are generated, not taken from real developers or real merge commits, so the rates describe this kind of small edit, not collaborative work in general. Replaying real merge commits from public repositories is the obvious next step.
- The corpus is one project's TypeScript, Rust, JSON and CSS.
- "Valid" means the Lezer grammar reports no error node; it says nothing about type errors or behaviour.
- A suggested fix is a text that parses and keeps part of the other person's change. It may not mean what either person intended, which is why the app shows it for approval.
`;

mkdirSync(join(root, "research", "merge-study"), { recursive: true });
writeFileSync(join(root, "research", "merge-study", "results.md"), md);
writeFileSync(join(root, "research", "merge-study", "results.json"), JSON.stringify({ rows: rows.length, files: used, broken: broken.length, fixed: fixed.length, outcomes: rows }, null, 0));
console.log(md);
console.log(`${((Date.now() - started) / 1000).toFixed(0)}s, wrote ${relative(root, join(root, "research", "merge-study", "results.md"))}`);
