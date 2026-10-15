// The runs of project tasks on this device: what each printed, whether it is ready, which ports it opened and the problems it
// reported. Kept outside the page so a run goes on, and its output stays, while another page is open. Events arrive from the
// backend; a run that is not known yet is created from its first event.

import { useSyncExternalStore } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { Problem } from "@/types/projects";

export interface RunLine {
	stream: "stdout" | "stderr";
	text: string;
}

export interface Run {
	runId: string;
	project: string;
	task: string;
	startedAt: number;
	status: "running" | "ready" | "done";
	code: number | null;
	stopped: boolean;
	restarts: number;
	error: string | null;
	lines: RunLine[];
	// Output dropped from the front when a run printed more than the page keeps
	dropped: number;
	ports: { port: number; open: boolean }[];
	problems: Problem[];
}

export const MAX_LINES = 3000;

let runs: Run[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const blank = (runId: string, project: string, task: string): Run => ({ runId, project, task, startedAt: Date.now(), status: "running", code: null, stopped: false, restarts: 0, error: null, lines: [], dropped: 0, ports: [], problems: [] });

// Changes one run (making it if it is new) and tells whoever is looking
function update(runId: string, project: string, task: string, change: (r: Run) => Run) {
	const at = runs.findIndex((r) => r.runId === runId);
	const next = change(at < 0 ? blank(runId, project, task) : runs[at]);
	runs = at < 0 ? [next, ...runs] : runs.map((r, i) => (i === at ? next : r));
	emit();
}

export const sameProblem = (a: Problem, b: Problem) => a.file === b.file && a.line === b.line && a.column === b.column && a.message === b.message;

// Pure: the run after a line of output
export function withLine(r: Run, line: RunLine): Run {
	const lines = r.lines.length >= MAX_LINES ? [...r.lines.slice(r.lines.length - MAX_LINES + 1), line] : [...r.lines, line];
	return { ...r, lines, dropped: r.dropped + (r.lines.length >= MAX_LINES ? 1 : 0) };
}

interface Ids {
	runId: string;
	project: string;
	task: string;
}

let listening: Promise<UnlistenFn[]> | null = null;

// Starts listening to the backend, once
export function listenToRuns() {
	listening ??= Promise.all([
		listen<Ids & { stream: RunLine["stream"]; text: string }>("project://output", ({ payload: p }) => update(p.runId, p.project, p.task, (r) => withLine(r, { stream: p.stream, text: p.text }))),
		listen<Ids>("project://ready", ({ payload: p }) => update(p.runId, p.project, p.task, (r) => (r.status === "running" ? { ...r, status: "ready" } : r))),
		listen<Ids & { code: number | null; stopped: boolean; restarts: number; error: string | null }>("project://exit", ({ payload: p }) => update(p.runId, p.project, p.task, (r) => ({ ...r, status: "done", code: p.code, stopped: p.stopped, restarts: p.restarts, error: p.error }))),
		listen<{ runId: string; project: string; port: number; open: boolean }>("project://port", ({ payload: p }) => update(p.runId, p.project, "", (r) => (r.ports.some((x) => x.port === p.port) ? r : { ...r, ports: [...r.ports, { port: p.port, open: p.open }] }))),
		listen<Ids & { problem: Problem }>("project://problem", ({ payload: p }) => update(p.runId, p.project, p.task, (r) => (r.problems.some((x) => sameProblem(x, p.problem)) || r.problems.length >= 200 ? r : { ...r, problems: [...r.problems, p.problem] }))),
	]);
}

const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => void listeners.delete(l);
};
const snapshot = () => runs;

export const useRuns = (project?: string): Run[] => {
	const all = useSyncExternalStore(subscribe, snapshot);
	return project === undefined ? all : all.filter((r) => r.project === project);
};

export const runsNow = () => runs;

export function forgetRun(runId: string) {
	runs = runs.filter((r) => r.runId !== runId);
	emit();
}

// Removes the runs that have ended
export function forgetFinished(project: string) {
	runs = runs.filter((r) => r.project !== project || r.status !== "done");
	emit();
}

// Resolves when the run is ready (a server) or has ended; rejects if it ends badly or takes longer than `ms`
export function waitForRun(runId: string, ms = 180_000): Promise<Run> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => finish(new Error("It took too long to become ready.")), ms);
		const finish = (err?: Error, r?: Run) => {
			clearTimeout(timer);
			off();
			err ? reject(err) : resolve(r!);
		};
		const check = () => {
			const r = runs.find((x) => x.runId === runId);
			if (!r) return;
			if (r.status === "done") finish(r.code === 0 && !r.error ? undefined : new Error(r.stopped ? "It was stopped." : r.error ?? `It ended with code ${r.code ?? "none"}.`), r);
			else if (r.status === "ready") finish(undefined, r);
		};
		const off = subscribe(check);
		check();
	});
}

// Test only
export const resetRuns = () => {
	runs = [];
	emit();
};
