// Running only the tests a change can reach, and spotting tests that pass and fail without a change to explain it.

import { SAFE_ARG, type TestReport } from "@/lib/testResults";
import type { Impact, RunRecord } from "@/types/projects";

// When the test task last passed on this device (the start of that run), or 0 when it never has
export function lastGreen(history: RunRecord[], taskId = "test"): number {
	return history.filter((h) => h.task === taskId && h.code === 0 && !h.stopped).reduce((t, h) => Math.max(t, h.started), 0);
}

// The arguments that run just these test files, added to the approved command; null when the runner is not one that takes files
// this way, or there are none, or too many to pass
export function impactArgs(command: string, language: Impact["language"], tests: string[]): string[] | null {
	if (tests.length === 0 || tests.length > 40 || !tests.every((t) => SAFE_ARG.test(t))) return null;
	if (language === "js" && /\b(vitest|jest|test)\b/.test(command) && !/\b(playwright|cypress|mocha)\b/.test(command)) return ["--", ...tests];
	if (language === "python" && /\bpytest\b/.test(command)) return tests;
	return null;
}

export interface Unstable {
	name: string;
	runs: number;
	fails: number;
	// How many times the result changed between one run and the next
	flips: number;
}

// Tests whose result went back and forth across the reports (oldest first): at least two changes, so a test that broke and was
// fixed once is not counted. A real regression fixed and broken again looks the same, so this says "unstable", not "flaky".
export function unstable(reports: TestReport[]): Unstable[] {
	const seen = new Map<string, ("pass" | "fail")[]>();
	for (const r of reports) {
		for (const t of r.tests) {
			if (t.status === "skip") continue;
			const key = `${t.file ?? ""}::${t.name}`;
			seen.set(key, [...(seen.get(key) ?? []), t.status]);
		}
	}
	const out: Unstable[] = [];
	for (const [key, results] of seen) {
		const flips = results.filter((s, i) => i > 0 && s !== results[i - 1]).length;
		if (flips >= 2) out.push({ name: key.replace(/^::/, ""), runs: results.length, fails: results.filter((s) => s === "fail").length, flips });
	}
	return out.sort((a, b) => b.flips - a.flips || a.name.localeCompare(b.name));
}
