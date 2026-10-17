import { describe, expect, it } from "vitest";

import { impactArgs, lastGreen, unstable } from "@/features/projects/lib/testImpact";
import type { TestReport } from "@/features/projects/lib/testResults";

const rec = (task: string, code: number | null, started: number, stopped = false) => ({ runId: String(started), project: "p", task, started, durationMs: 1, code, stopped, restarts: 0 });
const report = (...results: [string, "pass" | "fail" | "skip"][]): TestReport => ({ runner: "jest", passed: 0, failed: 0, skipped: 0, tests: results.map(([name, status]) => ({ name, status })) } as TestReport);

describe("testImpact", () => {
	it("finds when the tests last passed", () => {
		expect(lastGreen([rec("test", 1, 30), rec("test", 0, 20), rec("test", 0, 10), rec("build", 0, 40), rec("test", 0, 50, true)])).toBe(20);
		expect(lastGreen([])).toBe(0);
	});

	it("passes files to the runners that take them, and to no other", () => {
		expect(impactArgs("npm test", "js", ["src/a.test.ts"])).toEqual(["--", "src/a.test.ts"]);
		expect(impactArgs("npx vitest run", "js", ["a.test.ts", "b.test.ts"])).toEqual(["--", "a.test.ts", "b.test.ts"]);
		expect(impactArgs("pytest -q", "python", ["tests/test_a.py"])).toEqual(["tests/test_a.py"]);
		expect(impactArgs("npx playwright test", "js", ["a.spec.ts"])).toBeNull();
		expect(impactArgs("npm test", "js", [])).toBeNull();
		expect(impactArgs("npm test", "js", ["a; rm -rf x.test.ts"])).toBeNull();
		expect(impactArgs("go test ./...", "other", ["a_test.go"])).toBeNull();
	});

	it("calls a test unstable only after it changed result at least twice", () => {
		const reports = [report(["a", "pass"], ["b", "fail"], ["c", "pass"], ["d", "pass"]), report(["a", "fail"], ["b", "pass"], ["c", "pass"], ["d", "skip"]), report(["a", "pass"], ["b", "pass"], ["c", "pass"], ["d", "fail"])];
		expect(unstable(reports)).toEqual([{ name: "a", runs: 3, fails: 1, flips: 2 }]);
	});
});
