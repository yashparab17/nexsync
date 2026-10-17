// Language intelligence on the page: turning what a language server says into what the editor shows, and keeping the problems it
// reported where the Problems list can read them. The server runs in the backend (Phase 20, step 9); this file has no network of its own.

import { listen } from "@tauri-apps/api/event";
import { useMemo, useSyncExternalStore } from "react";

export interface LspPosition {
	line: number;
	character: number;
}
export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}
export interface LspDiagnostic {
	range: LspRange;
	// 1 error, 2 warning, 3 information, 4 hint
	severity?: number;
	message: string;
	source?: string;
	code?: string | number;
}

// ── the problems each server reported, by file ──

type Key = string;
const files = new Map<Key, LspDiagnostic[]>();
const listeners = new Set<() => void>();
let snapshot: { project: string; rel: string; diagnostics: LspDiagnostic[] }[] = [];
const keyOf = (project: string, rel: string) => `${project}\u0000${rel}`;

function publish() {
	snapshot = [...files].map(([k, diagnostics]) => {
		const [project, rel] = k.split("\u0000");
		return { project, rel, diagnostics };
	});
	listeners.forEach((l) => l());
}

export function setFileDiagnostics(project: string, rel: string, diagnostics: LspDiagnostic[]) {
	if (diagnostics.length === 0) files.delete(keyOf(project, rel));
	else files.set(keyOf(project, rel), diagnostics);
	publish();
}

export const diagnosticsOf = (project: string, rel: string): LspDiagnostic[] => files.get(keyOf(project, rel)) ?? [];

export function clearProject(project: string) {
	for (const k of [...files.keys()]) if (k.startsWith(`${project}\u0000`)) files.delete(k);
	publish();
}

export function onFileDiagnostics(project: string, rel: string, cb: () => void): () => void {
	const wrapped = () => cb();
	const l = (e: Event) => {
		const d = (e as CustomEvent<{ project: string; rel: string }>).detail;
		if (d.project === project && d.rel === rel) wrapped();
	};
	window.addEventListener("nexsync-lsp-diagnostics", l);
	return () => window.removeEventListener("nexsync-lsp-diagnostics", l);
}

let listening = false;
export function listenToLsp() {
	if (listening) return;
	listening = true;
	void listen<{ project: string; rel: string; diagnostics: LspDiagnostic[] }>("lsp://diagnostics", ({ payload: p }) => {
		setFileDiagnostics(p.project, p.rel, p.diagnostics);
		window.dispatchEvent(new CustomEvent("nexsync-lsp-diagnostics", { detail: { project: p.project, rel: p.rel } }));
	}).catch(() => {
		// Outside the desktop app there is no backend to listen to
		listening = false;
	});
}

// The problems of a project as list rows (errors and warnings; information and hints are for the editor only)
export interface LspProblem {
	file: string;
	line: number;
	column: number;
	severity: "error" | "warning";
	message: string;
}

export function problemsOf(all: typeof snapshot, project: string): LspProblem[] {
	return all
		.filter((f) => f.project === project)
		.flatMap((f) => f.diagnostics.filter((d) => (d.severity ?? 1) <= 2).map((d) => ({ file: f.rel, line: d.range.start.line + 1, column: d.range.start.character + 1, severity: (d.severity ?? 1) === 1 ? ("error" as const) : ("warning" as const), message: d.message.split("\n")[0] })))
		.sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error") || a.file.localeCompare(b.file) || a.line - b.line);
}

export function useLspProblems(project: string | null): LspProblem[] {
	const all = useSyncExternalStore(
		(cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		() => snapshot,
	);
	return useMemo(() => (project ? problemsOf(all, project) : []), [all, project]);
}

// ── reading answers ──

// The text of a hover: a string, a {kind, value}, a {language, value}, or a list of them; code fences are dropped
export function hoverText(result: unknown): string {
	const parts = (c: unknown): string[] => {
		if (typeof c === "string") return [c];
		if (Array.isArray(c)) return c.flatMap(parts);
		if (c && typeof c === "object" && typeof (c as { value?: unknown }).value === "string") return [(c as { value: string }).value];
		return [];
	};
	const contents = (result as { contents?: unknown } | null)?.contents;
	return parts(contents)
		.map((p) => p.replace(/^```[\w+-]*\n?/gm, "").replace(/\n?```$/gm, "").trim())
		.filter(Boolean)
		.join("\n\n")
		.slice(0, 2000);
}

export interface Place {
	// Inside the project, when the place is
	rel?: string;
	uri: string;
	line: number;
	character: number;
}

// The first place a definition request found: a Location, a list of them, or LocationLinks
export function firstPlace(result: unknown): Place | null {
	const one = (Array.isArray(result) ? result[0] : result) as { uri?: string; targetUri?: string; rel?: string; range?: LspRange; targetSelectionRange?: LspRange; targetRange?: LspRange } | null | undefined;
	if (!one) return null;
	const uri = one.targetUri ?? one.uri;
	const range = one.targetSelectionRange ?? one.targetRange ?? one.range;
	if (!uri || !range) return null;
	return { rel: one.rel, uri, line: range.start.line, character: range.start.character };
}

// LSP positions count UTF-16 units, as strings in JavaScript do, so a position is a line start plus the character
export interface LineSource {
	lines: number;
	line(n: number): { from: number; to: number };
}

export function offsetOf(doc: LineSource, p: LspPosition): number {
	const line = doc.line(Math.min(Math.max(p.line + 1, 1), doc.lines));
	return Math.min(line.from + p.character, line.to);
}

export const severityOf = (s?: number): "error" | "warning" | "info" => (s === 1 || s === undefined ? "error" : s === 2 ? "warning" : "info");

const KINDS: Record<number, string> = { 2: "method", 3: "function", 4: "function", 5: "property", 6: "variable", 7: "class", 8: "interface", 9: "namespace", 10: "property", 13: "enum", 14: "keyword", 15: "text", 20: "constant", 21: "constant", 22: "class", 25: "type" };

export interface CompletionLike {
	label: string;
	detail?: string;
	type?: string;
	apply: string;
	// A range on the line the server wants replaced, in offsets of the document
	from?: number;
	to?: number;
}

// The items of a completion answer (a list or {items}) as editor completions, most relevant first
export function completionsOf(result: unknown, doc: LineSource): CompletionLike[] {
	const items = (Array.isArray(result) ? result : (result as { items?: unknown[] } | null)?.items ?? []) as {
		label?: string;
		detail?: string;
		kind?: number;
		insertText?: string;
		sortText?: string;
		textEdit?: { newText?: string; range?: LspRange; replace?: LspRange };
	}[];
	return items
		.filter((i) => typeof i.label === "string")
		.sort((a, b) => (a.sortText ?? a.label!).localeCompare(b.sortText ?? b.label!))
		.slice(0, 200)
		.map((i) => {
			const range = i.textEdit?.range ?? i.textEdit?.replace;
			return {
				label: i.label!,
				detail: i.detail,
				type: i.kind ? KINDS[i.kind] : undefined,
				apply: i.textEdit?.newText ?? i.insertText ?? i.label!,
				...(range ? { from: offsetOf(doc, range.start), to: offsetOf(doc, range.end) } : {}),
			};
		});
}

// `projects/app/src/a.ts` is file `src/a.ts` of project `app`; anything else has no language server
export function lspTarget(path: string): { project: string; rel: string } | null {
	const m = /^\/?projects\/([^/]+)\/(.+)$/.exec(path);
	return m ? { project: m[1], rel: m[2] } : null;
}
