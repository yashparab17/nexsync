// What members chose to share about a project on their own device: the tools they have (kind "devenv") and what they are
// running and how the last test run went (kind "devrun"). Both are signed entries of the workspace log; the newest of each
// author and project is the one that counts. Nothing is shared unless the person turns it on.

import type { LogEntry } from "@/features/chat/lib/entries";
import { plain } from "@/lib/ansi";
import type { Doctor } from "@/features/projects/types";

export interface EnvShare {
	tools: { name: string; range: string; found: string | null; state: string }[];
	os: string;
	// The dependencies are installed and current on that device
	installed: boolean;
}

export interface RunShare {
	// Tasks running now
	running: string[];
	// Tasks that have ended or run on that device before
	ever: string[];
	// The last run of the test task
	test: { ok: boolean; at: number } | null;
	at: number;
}

// A failed run a member chose to share: the task, how it ended, the tail of its output and the tools on that device
export interface ReproShare {
	task: string;
	command: string;
	code: number | null;
	durationMs: number;
	startedAt: number;
	os: string;
	tools: EnvShare["tools"];
	log: string;
	// The log was longer than what is kept
	cut: boolean;
	problems: { file: string; line: number; message: string }[];
}

export const reproChannel = (project: string) => `devrepro:${project}`;

// The end of a run's output as plain text, at most `max` characters, starting at a line
export function tailOf(lines: string[], max = 12_000): { text: string; cut: boolean } {
	const clean = lines.map((l) => plain(l));
	let size = 0;
	let from = clean.length;
	while (from > 0 && size + clean[from - 1].length + 1 <= max) size += clean[--from].length + 1;
	return { text: clean.slice(from).join("\n"), cut: from > 0 };
}

// What differs between the tools on the device that shared a failure and the tools here
export function toolsDiffer(theirs: EnvShare["tools"], mine: EnvShare["tools"]): { tool: string; theirs: string; mine: string }[] {
	const out: { tool: string; theirs: string; mine: string }[] = [];
	for (const t of theirs) {
		const m = mine.find((x) => x.name === t.name);
		if ((t.found ?? "missing") !== (m?.found ?? "missing")) out.push({ tool: t.name, theirs: t.found ?? "missing", mine: m?.found ?? "missing" });
	}
	return out;
}

export const envChannel = (project: string) => `devenv:${project}`;
export const runChannel = (project: string) => `devrun:${project}`;

export interface Member<T> {
	key: string;
	name: string;
	ts: number;
	data: T;
}

// The newest entry of each author in one channel, with its body read
export function newest<T>(entries: LogEntry[], kind: "devenv" | "devrun", channel: string): Member<T>[] {
	const best = new Map<string, LogEntry>();
	for (const e of entries) {
		if (e.kind !== kind || e.channel !== channel) continue;
		const prior = best.get(e.author);
		if (!prior || e.ts >= prior.ts) best.set(e.author, e);
	}
	const out: Member<T>[] = [];
	for (const e of best.values()) {
		try {
			out.push({ key: e.author, name: e.name, ts: e.ts, data: JSON.parse(e.body) as T });
		} catch {
			/* an entry that is not JSON is left out */
		}
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Every entry of a kind in a channel, newest first
export function all<T>(entries: LogEntry[], kind: "devrepro", channel: string): Member<T>[] {
	const out: Member<T>[] = [];
	for (const e of entries) {
		if (e.kind !== kind || e.channel !== channel) continue;
		try {
			out.push({ key: e.author, name: e.name, ts: e.ts, data: JSON.parse(e.body) as T });
		} catch {
			/* left out */
		}
	}
	return out.sort((a, b) => b.ts - a.ts);
}

export const envShareOf = (doctor: Doctor, installed: boolean): EnvShare => ({
	tools: doctor.tools.map((t) => ({ name: t.name, range: t.range, found: t.found, state: t.state })),
	os: /Win/i.test(navigator.platform) ? "Windows" : /Mac/i.test(navigator.platform) ? "macOS" : "Linux",
	installed,
});

export interface ToolRow {
	tool: string;
	range: string;
	// Who has which version ("missing" for none), the most common first
	groups: { version: string; people: string[] }[];
	// Not everyone has the same version
	mixed: boolean;
}

// The tools side by side: for each tool, who has what. Rows where the versions differ come first.
export function diffTools(members: Member<EnvShare>[]): ToolRow[] {
	const names = new Set<string>();
	for (const m of members) for (const t of m.data.tools ?? []) names.add(t.name);
	const rows: ToolRow[] = [];
	for (const tool of names) {
		const by = new Map<string, string[]>();
		let range = "";
		for (const m of members) {
			const t = m.data.tools?.find((x) => x.name === tool);
			if (t?.range) range = t.range;
			const version = t?.found ?? "missing";
			by.set(version, [...(by.get(version) ?? []), m.name]);
		}
		const groups = [...by].map(([version, people]) => ({ version, people })).sort((a, b) => b.people.length - a.people.length || a.version.localeCompare(b.version));
		rows.push({ tool, range, groups, mixed: groups.length > 1 });
	}
	return rows.sort((a, b) => Number(b.mixed) - Number(a.mixed) || a.tool.localeCompare(b.tool));
}

// "Node 22 here, 20 for three others": the sentence for a mixed row, from one member's point of view
export function mixedNote(row: ToolRow, me: string): string | null {
	if (!row.mixed) return null;
	const mine = row.groups.find((g) => g.people.includes(me));
	const others = row.groups.filter((g) => g !== mine);
	const count = (n: number) => (n === 1 ? "one other" : `${n} others`);
	if (!mine) return `${row.groups.map((g) => `${g.version} for ${g.people.length}`).join(", ")}`;
	return `${mine.version} here, ${others.map((g) => `${g.version} for ${count(g.people.length)}`).join(", ")}`;
}

export interface Step {
	id: "tools" | "install" | "server" | "tests";
	label: string;
	done: boolean;
}

// Getting started, step by step, for one member: what the recipe asks for, and how much of it that device has done.
// `hasServer` and `hasTests` say whether the recipe has such a task at all; a step with nothing to do is left out.
export function checklist(env: EnvShare | undefined, run: RunShare | undefined, recipe: { server: string[]; tests: boolean; install: boolean }): Step[] {
	const steps: Step[] = [{ id: "tools", label: "Tools are installed at the right versions", done: !!env && env.tools.every((t) => t.state === "ok" || t.state === "unknown") }];
	if (recipe.install) steps.push({ id: "install", label: "Dependencies are installed", done: !!env?.installed });
	if (recipe.server.length > 0) steps.push({ id: "server", label: "The app has run on this device", done: !!run && recipe.server.some((s) => run.ever.includes(s) || run.running.includes(s)) });
	if (recipe.tests) steps.push({ id: "tests", label: "The tests pass", done: !!run?.test?.ok });
	return steps;
}

// Whether what a device would publish is what its last entry already said (the time of an entry does not count)
export const sameShare = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const runShareOf = (running: string[], history: { task: string; code: number | null; stopped: boolean; started: number }[], now: number): RunShare => {
	const tests = history.filter((h) => h.task === "test" && !h.stopped).sort((a, b) => b.started - a.started)[0];
	return {
		running: [...new Set(running)].sort(),
		ever: [...new Set(history.map((h) => h.task))].sort(),
		test: tests ? { ok: tests.code === 0, at: tests.started } : null,
		at: now,
	};
};
