import { describe, expect, it } from "vitest";

import { MAX_LINES, mergeRuns, withLine, withLines, type Run } from "./projectRuns";

const run = (): Run => ({ runId: "r", project: "app", task: "dev", startedAt: 0, status: "running", code: null, stopped: false, restarts: 0, error: null, lines: [], dropped: 0, ports: [], problems: [] });

describe("projectRuns", () => {
	it("puts the output of two runs in the order it arrived", () => {
		const a = { ...run(), task: "web", lines: [{ stream: "stdout" as const, text: "a1", at: 1 }, { stream: "stdout" as const, text: "a2", at: 5 }] };
		const b = { ...run(), task: "api", lines: [{ stream: "stdout" as const, text: "b1", at: 3 }, { stream: "stderr" as const, text: "b2", at: 5 }] };
		expect(mergeRuns([a, b]).map((m) => `${m.task}:${m.line.text}`)).toEqual(["web:a1", "api:b1", "web:a2", "api:b2"]);
		expect(mergeRuns([a, b], 2).map((m) => m.line.text)).toEqual(["a2", "b2"]);
	});

	it("adds a batch in one go and keeps the newest lines", () => {
		const batch = Array.from({ length: MAX_LINES + 10 }, (_, i) => ({ stream: "stdout" as const, text: String(i) }));
		const r = withLines(run(), batch);
		expect(r.lines).toHaveLength(MAX_LINES);
		expect(r.lines[0].text).toBe("10");
		expect(r.dropped).toBe(10);
		expect(withLines(run(), [])).toEqual(run());
	});

	it("keeps the newest lines and counts the ones dropped", () => {
		let r = run();
		for (let i = 0; i < MAX_LINES + 5; i++) r = withLine(r, { stream: "stdout", text: String(i) });
		expect(r.lines).toHaveLength(MAX_LINES);
		expect(r.lines[0].text).toBe("5");
		expect(r.lines[r.lines.length - 1].text).toBe(String(MAX_LINES + 4));
		expect(r.dropped).toBe(5);
	});
});
