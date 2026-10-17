// What a test run reported, read from the output the runners print: Jest and Vitest as JSON, `go test` as JSON or with -v,
// `cargo test`, `pytest -v` and TAP. Output in another form gives null and the page shows it as plain text. A name or a message
// comes from the program's output, so it is only ever shown, or passed on as a checked argument.

import { plain } from "@/lib/ansi";

export type Runner = "jest" | "go" | "cargo" | "pytest" | "tap";

export interface TestCase {
	name: string;
	file?: string;
	status: "pass" | "fail" | "skip";
	message?: string;
}

export interface TestReport {
	runner: Runner;
	tests: TestCase[];
	passed: number;
	failed: number;
	skipped: number;
}

const report = (runner: Runner, tests: TestCase[]): TestReport | null =>
	tests.length === 0 ? null : { runner, tests, passed: tests.filter((t) => t.status === "pass").length, failed: tests.filter((t) => t.status === "fail").length, skipped: tests.filter((t) => t.status === "skip").length };

const MESSAGE_LINES = 12;
const cut = (lines: string[]) => lines.slice(0, MESSAGE_LINES).join("\n").trim() || undefined;

function jest(lines: string[]): TestReport | null {
	const blob = lines.find((l) => l.trimStart().startsWith("{") && l.includes('"testResults"'));
	if (!blob) return null;
	try {
		const data = JSON.parse(blob) as { testResults?: { name?: string; assertionResults?: { fullName?: string; title?: string; status?: string; failureMessages?: string[] }[] }[] };
		const tests: TestCase[] = [];
		for (const f of data.testResults ?? []) {
			for (const a of f.assertionResults ?? []) {
				const status = a.status === "passed" ? "pass" : a.status === "failed" ? "fail" : "skip";
				tests.push({ name: a.fullName ?? a.title ?? "(unnamed)", file: f.name, status, message: status === "fail" ? cut(plain((a.failureMessages ?? []).join("\n")).split("\n")) : undefined });
			}
		}
		return report("jest", tests);
	} catch {
		return null;
	}
}

function goJson(lines: string[]): TestReport | null {
	const tests = new Map<string, TestCase>();
	const out = new Map<string, string[]>();
	let any = false;
	for (const l of lines) {
		if (!l.startsWith("{") || !l.includes('"Action"')) continue;
		try {
			const e = JSON.parse(l) as { Action: string; Test?: string; Package?: string; Output?: string };
			any = true;
			if (!e.Test) continue;
			const key = `${e.Package ?? ""}/${e.Test}`;
			if (e.Action === "output") out.set(key, [...(out.get(key) ?? []), (e.Output ?? "").trimEnd()]);
			else if (e.Action === "pass" || e.Action === "fail" || e.Action === "skip") tests.set(key, { name: e.Test, file: e.Package, status: e.Action === "pass" ? "pass" : e.Action === "fail" ? "fail" : "skip" });
		} catch {
			// A line that is not JSON is not part of the report
		}
	}
	if (!any) return null;
	for (const [key, t] of tests) if (t.status === "fail") t.message = cut((out.get(key) ?? []).filter((l) => !/^(=== |--- )/.test(l)));
	return report("go", [...tests.values()]);
}

function goText(lines: string[]): TestReport | null {
	const tests: TestCase[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = /^\s*--- (PASS|FAIL|SKIP): (\S+)/.exec(lines[i]);
		if (!m) continue;
		const message: string[] = [];
		for (let j = i + 1; j < lines.length && /^\s{4,}\S/.test(lines[j]); j++) message.push(lines[j].trim());
		tests.push({ name: m[2], status: m[1] === "PASS" ? "pass" : m[1] === "FAIL" ? "fail" : "skip", message: m[1] === "FAIL" ? cut(message) : undefined });
	}
	return report("go", tests);
}

function cargo(lines: string[]): TestReport | null {
	const tests: TestCase[] = [];
	for (const l of lines) {
		const m = /^test (\S+) \.\.\. (ok|FAILED|ignored)/.exec(l);
		if (m) tests.push({ name: m[1], status: m[2] === "ok" ? "pass" : m[2] === "FAILED" ? "fail" : "skip" });
	}
	// The failures are explained further down, each under `---- name stdout ----`
	let current: TestCase | undefined;
	let body: string[] = [];
	const close = () => {
		if (current) current.message = cut(body);
		current = undefined;
		body = [];
	};
	for (const l of lines) {
		const h = /^---- (\S+) stdout ----$/.exec(l);
		if (h) {
			close();
			current = tests.find((t) => t.name === h[1] && t.status === "fail");
		} else if (/^failures:\s*$/.test(l) || /^test result:/.test(l)) close();
		else if (current && l.trim()) body.push(l);
	}
	close();
	return report("cargo", tests);
}

function pytest(lines: string[]): TestReport | null {
	const tests: TestCase[] = [];
	for (const l of lines) {
		const m = /^(\S+\.py)::(\S+)\s+(PASSED|FAILED|SKIPPED|XFAIL|XPASS|ERROR)\b/.exec(l);
		if (m) tests.push({ file: m[1], name: m[2], status: m[3] === "PASSED" || m[3] === "XPASS" ? "pass" : m[3] === "SKIPPED" || m[3] === "XFAIL" ? "skip" : "fail" });
	}
	// `_____ test_name _____` starts a failure's report, whose lines that begin with E say what went wrong
	let current: TestCase | undefined;
	const body = new Map<TestCase, string[]>();
	for (const l of lines) {
		const h = /^_{3,} (?:\S+\.)?(\S+?)(?:\[.*\])? _{3,}$/.exec(l);
		if (h) current = tests.find((t) => t.status === "fail" && (t.name === h[1] || t.name.startsWith(`${h[1]}[`)));
		else if (current && /^E\s/.test(l)) body.set(current, [...(body.get(current) ?? []), l.replace(/^E\s+/, "")]);
	}
	for (const [t, b] of body) t.message = cut(b);
	return report("pytest", tests);
}

function tap(lines: string[]): TestReport | null {
	const tests: TestCase[] = [];
	for (const l of lines) {
		const m = /^(not )?ok \d+(?: - |\s+)(.*)$/.exec(l);
		if (!m) continue;
		const skip = /# (SKIP|TODO)/i.test(m[2]);
		tests.push({ name: m[2].replace(/\s*#.*$/, "").trim() || "(unnamed)", status: skip ? "skip" : m[1] ? "fail" : "pass" });
	}
	return report("tap", tests);
}

// The test report in a run's output, whichever form it is in, or null
export function parseTests(output: string[]): TestReport | null {
	const lines = output.map((l) => plain(l));
	return jest(lines) ?? goJson(lines) ?? cargo(lines) ?? pytest(lines) ?? goText(lines) ?? tap(lines);
}

// Characters the backend passes to a command as an argument
export const SAFE_ARG = /^[A-Za-z0-9_:./\- #[\],=]{1,200}$/;

// The arguments that run just this test, added to the command the person approved for the task; null when the runner has no
// way, the task is not that runner's, or the name has characters that are not passed to a command
export function runOneArgs(runner: Runner, command: string, t: TestCase): string[] | null {
	let args: string[] | null = null;
	if (runner === "cargo" && /\bcargo\s+(test|nextest run)\b/.test(command)) args = [t.name, "--", "--exact"];
	else if (runner === "go" && /\bgo\s+test\b/.test(command)) args = ["-run", t.name];
	else if (runner === "pytest" && /\bpytest\b/.test(command) && t.file) args = [`${t.file}::${t.name}`];
	else if (runner === "jest" && /\b(jest|vitest|test)\b/.test(command)) args = ["--", "-t", t.name];
	return args && args.every((a) => SAFE_ARG.test(a)) ? args : null;
}
