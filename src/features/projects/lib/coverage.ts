// Coverage from the report files runners write (lcov, Cobertura): which lines of which files a test run reached. Kept in memory
// while the app is open, per workspace path; the editor shades its gutter from it and the Tests tab lists the files.

import { gutter, GutterMarker } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { useSyncExternalStore } from "react";

export interface FileCoverage {
	// File as the report names it, relative to the project
	file: string;
	// Line number to the times it ran
	lines: Map<number, number>;
}

export const percent = (c: FileCoverage) => {
	const total = c.lines.size;
	if (total === 0) return 100;
	let hit = 0;
	c.lines.forEach((n) => n > 0 && hit++);
	return Math.round((hit / total) * 100);
};

// lcov: `SF:path`, then `DA:line,hits` for each line, then `end_of_record`
export function parseLcov(text: string): FileCoverage[] {
	const out: FileCoverage[] = [];
	let cur: FileCoverage | null = null;
	for (const raw of text.split(/\r?\n/)) {
		if (raw.startsWith("SF:")) cur = { file: raw.slice(3).trim().replace(/\\/g, "/"), lines: new Map() };
		else if (raw.startsWith("DA:") && cur) {
			const [line, hits] = raw.slice(3).split(",");
			if (Number(line) > 0) cur.lines.set(Number(line), Number(hits) || 0);
		} else if (raw === "end_of_record" && cur) {
			out.push(cur);
			cur = null;
		}
	}
	return out;
}

// Cobertura XML: <class filename><lines><line number hits/>
export function parseCobertura(xml: string): FileCoverage[] {
	const doc = new DOMParser().parseFromString(xml, "application/xml");
	if (doc.getElementsByTagName("parsererror").length > 0) return [];
	const byFile = new Map<string, FileCoverage>();
	for (const c of Array.from(doc.getElementsByTagName("class"))) {
		const file = (c.getAttribute("filename") ?? "").replace(/\\/g, "/");
		if (!file) continue;
		const entry = byFile.get(file) ?? { file, lines: new Map() };
		for (const l of Array.from(c.getElementsByTagName("line"))) {
			const n = Number(l.getAttribute("number"));
			if (n > 0) entry.lines.set(n, Math.max(entry.lines.get(n) ?? 0, Number(l.getAttribute("hits")) || 0));
		}
		byFile.set(file, entry);
	}
	return [...byFile.values()];
}

// A report names files relative to the project, or in full; the editor knows them as paths of the workspace
export function workspacePathOf(workspacePath: string, project: string, file: string): string {
	const norm = (p: string) => p.replace(/\\/g, "/");
	const root = norm(workspacePath).replace(/\/+$/, "").toLowerCase();
	const f = norm(file).replace(/^\.\//, "");
	if (f.toLowerCase().startsWith(`${root}/`)) return f.slice(root.length + 1);
	const inProject = f.toLowerCase().indexOf(`/projects/${project.toLowerCase()}/`);
	if (inProject >= 0) return f.slice(inProject + 1);
	return `projects/${project}/${f.replace(/^\/+/, "")}`;
}

// ── the store ──

let byPath = new Map<string, Map<number, number>>();
let version = 0;
const listeners = new Set<() => void>();

export function setCoverage(workspacePath: string, project: string, files: FileCoverage[]) {
	// Loading a report replaces what an earlier one said about this project's files
	const prefix = `projects/${project}/`;
	const next = new Map([...byPath].filter(([p]) => !p.startsWith(prefix)));
	for (const f of files) next.set(workspacePathOf(workspacePath, project, f.file), f.lines);
	byPath = next;
	version++;
	listeners.forEach((l) => l());
}

export function clearCoverage() {
	byPath = new Map();
	version++;
	listeners.forEach((l) => l());
}

// The lines of one file, as the editor asks for them (`path` with or without a leading slash); null when no report covers it
export function useCoverage(path: string | null): Map<number, number> | null {
	useSyncExternalStore(
		(l) => {
			listeners.add(l);
			return () => void listeners.delete(l);
		},
		() => version,
	);
	return path ? (byPath.get(path.replace(/^\/+/, "")) ?? null) : null;
}

class Mark extends GutterMarker {
	constructor(readonly covered: boolean) {
		super();
	}
	eq(other: Mark) {
		return other.covered === this.covered;
	}
	toDOM() {
		const el = document.createElement("span");
		el.title = this.covered ? "Reached by the tests" : "Not reached by the tests";
		el.style.cssText = `display:block;width:3px;height:100%;margin-left:1px;background:var(${this.covered ? "--success" : "--destructive"});opacity:.85`;
		return el;
	}
}

// A thin bar in the gutter beside each line the report knows: green when the tests ran it, red when they did not
export function coverageGutter(lines: Map<number, number>): Extension {
	return gutter({
		class: "cm-coverage",
		lineMarker(view, line) {
			const hits = lines.get(view.state.doc.lineAt(line.from).number);
			return hits === undefined ? null : new Mark(hits > 0);
		},
		initialSpacer: () => new Mark(true),
	});
}
