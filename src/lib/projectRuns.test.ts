import { describe, expect, it } from "vitest";

import { MAX_LINES, withLine, type Run } from "./projectRuns";

const run = (): Run => ({ runId: "r", project: "app", task: "dev", startedAt: 0, status: "running", code: null, stopped: false, restarts: 0, error: null, lines: [], dropped: 0, ports: [], problems: [] });

describe("projectRuns", () => {
	it("keeps the newest lines and counts the ones dropped", () => {
		let r = run();
		for (let i = 0; i < MAX_LINES + 5; i++) r = withLine(r, { stream: "stdout", text: String(i) });
		expect(r.lines).toHaveLength(MAX_LINES);
		expect(r.lines[0].text).toBe("5");
		expect(r.lines[r.lines.length - 1].text).toBe(String(MAX_LINES + 4));
		expect(r.dropped).toBe(5);
	});
});
