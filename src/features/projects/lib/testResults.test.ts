import { describe, expect, it } from "vitest";

import { parseTests, runOneArgs } from "@/features/projects/lib/testResults";

const lines = (text: string) => text.split("\n");
const names = (r: ReturnType<typeof parseTests>) => r?.tests.map((t) => `${t.status}:${t.name}`);

describe("parseTests", () => {
	it("reads cargo test, with the explanation of a failure", () => {
		const r = parseTests(lines(["running 3 tests", "test math::adds ... ok", "test math::divides ... FAILED", "test io::slow ... ignored", "", "failures:", "", "---- math::divides stdout ----", "thread 'math::divides' panicked at src/math.rs:9:5:", "attempt to divide by zero", "", "failures:", "    math::divides", "", "test result: FAILED. 1 passed; 1 failed; 1 ignored"].join("\n")));
		expect(r?.runner).toBe("cargo");
		expect(names(r)).toEqual(["pass:math::adds", "fail:math::divides", "skip:io::slow"]);
		expect(r?.tests[1].message).toContain("attempt to divide by zero");
		expect([r?.passed, r?.failed, r?.skipped]).toEqual([1, 1, 1]);
	});

	it("reads pytest -v and the E lines of a failure", () => {
		const r = parseTests(lines(["tests/test_a.py::test_ok PASSED   [ 50%]", "tests/test_a.py::test_bad FAILED  [100%]", "", "___ test_bad ___", "def test_bad():", ">   assert 1 == 2", "E   assert 1 == 2", "E    +  where 1 = f()"].join("\n")));
		expect(names(r)).toEqual(["pass:test_ok", "fail:test_bad"]);
		expect(r?.tests[1]).toMatchObject({ file: "tests/test_a.py", message: "assert 1 == 2\n+  where 1 = f()" });
	});

	it("reads go test as JSON and with -v", () => {
		const json = [
			{ Action: "run", Test: "TestA", Package: "x" }, { Action: "output", Test: "TestB", Package: "x", Output: "    b_test.go:8: want 2 got 3\n" },
			{ Action: "pass", Test: "TestA", Package: "x" }, { Action: "fail", Test: "TestB", Package: "x" }, { Action: "fail", Package: "x" },
		].map((e) => JSON.stringify(e));
		const j = parseTests(json);
		expect(names(j)).toEqual(["pass:TestA", "fail:TestB"]);
		expect(j?.tests[1].message).toBe("b_test.go:8: want 2 got 3");
		const v = parseTests(lines("=== RUN   TestA\n--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.01s)\n    b_test.go:8: want 2 got 3\nFAIL"));
		expect(names(v)).toEqual(["pass:TestA", "fail:TestB"]);
		expect(v?.tests[1].message).toBe("b_test.go:8: want 2 got 3");
	});

	it("reads Jest and Vitest JSON and TAP", () => {
		const blob = JSON.stringify({ testResults: [{ name: "/w/a.test.ts", assertionResults: [{ fullName: "adds", status: "passed", failureMessages: [] }, { fullName: "divides", status: "failed", failureMessages: ["Error: expected 1\n at x"] }, { fullName: "later", status: "pending" }] }] });
		const j = parseTests(["some log", blob]);
		expect(names(j)).toEqual(["pass:adds", "fail:divides", "skip:later"]);
		expect(j?.tests[1].message).toContain("expected 1");
		expect(names(parseTests(lines("TAP version 13\nok 1 - adds\nnot ok 2 - divides\nok 3 - later # SKIP not now")))).toEqual(["pass:adds", "fail:divides", "skip:later"]);
	});

	it("gives null for output that is not a report", () => {
		expect(parseTests(lines("Compiled successfully\nlistening on 3000"))).toBeNull();
		expect(parseTests([])).toBeNull();
	});
});

describe("runOneArgs", () => {
	const t = { name: "math::divides", file: "tests/test_a.py", status: "fail" as const };
	it("builds the arguments for the runner the task uses", () => {
		expect(runOneArgs("cargo", "cargo test", t)).toEqual(["math::divides", "--", "--exact"]);
		expect(runOneArgs("pytest", "uv run pytest", t)).toEqual(["tests/test_a.py::math::divides"]);
		expect(runOneArgs("go", "go test ./...", { name: "TestB", status: "fail" })).toEqual(["-run", "TestB"]);
		expect(runOneArgs("jest", "pnpm run test", { name: "adds", status: "fail" })).toEqual(["--", "-t", "adds"]);
	});
	it("gives null when the task is not that runner or the name could not be passed safely", () => {
		expect(runOneArgs("cargo", "npm run test", t)).toBeNull();
		expect(runOneArgs("jest", "npm run test", { name: "adds; rm x", status: "fail" })).toBeNull();
		expect(runOneArgs("tap", "node --test", t)).toBeNull();
	});
});
