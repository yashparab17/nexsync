import { describe, expect, it } from "vitest";

import { parseCobertura, parseLcov, percent, workspacePathOf } from "@/features/projects/lib/coverage";
import { parseJunit, parseTrx } from "@/features/projects/lib/reportFiles";

describe("test report files", () => {
	it("reads JUnit XML: pass, fail with its text, skip", () => {
		const r = parseJunit(`<testsuites><testsuite name="s"><testcase classname="a.B" name="adds" time="0.1"/><testcase classname="a.B" name="divides"><failure message="boom">expected 1 got 2
  at a.B.divides</failure></testcase><testcase classname="a.B" name="later"><skipped/></testcase><testcase classname="a.C" name="crashes"><error message="npe"/></testcase></testsuite></testsuites>`);
		expect(r?.tests.map((t) => `${t.status}:${t.name}`)).toEqual(["pass:adds", "fail:divides", "skip:later", "fail:crashes"]);
		expect(r?.tests[1].message).toContain("expected 1 got 2");
		expect([r?.passed, r?.failed, r?.skipped]).toEqual([1, 2, 1]);
	});

	it("reads TRX", () => {
		const r = parseTrx(`<TestRun><Results><UnitTestResult testName="Adds" outcome="Passed"/><UnitTestResult testName="Divides" outcome="Failed"><Output><ErrorInfo><Message>Assert.Equal failed</Message></ErrorInfo></Output></UnitTestResult><UnitTestResult testName="Later" outcome="NotExecuted"/></Results></TestRun>`);
		expect(r?.tests.map((t) => `${t.status}:${t.name}`)).toEqual(["pass:Adds", "fail:Divides", "skip:Later"]);
		expect(r?.tests[1].message).toBe("Assert.Equal failed");
	});

	it("gives null for text that is not XML or has no tests", () => {
		expect(parseJunit("not xml <")).toBeNull();
		expect(parseJunit("<testsuites/>")).toBeNull();
		expect(parseTrx("<TestRun/>")).toBeNull();
	});
});

describe("coverage", () => {
	it("reads lcov and Cobertura into lines and hits", () => {
		const lcov = parseLcov("TN:\nSF:src/a.ts\nDA:1,3\nDA:2,0\nDA:4,1\nLF:3\nLH:2\nend_of_record\nSF:C:\\w\\b.ts\nDA:1,0\nend_of_record\n");
		expect(lcov.map((f) => f.file)).toEqual(["src/a.ts", "C:/w/b.ts"]);
		expect([...lcov[0].lines]).toEqual([[1, 3], [2, 0], [4, 1]]);
		expect(percent(lcov[0])).toBe(67);
		const cob = parseCobertura(`<coverage><packages><package><classes><class filename="src/a.py"><lines><line number="1" hits="2"/><line number="2" hits="0"/></lines></class><class filename="src/a.py"><lines><line number="2" hits="1"/></lines></class></classes></package></packages></coverage>`);
		expect(cob).toHaveLength(1);
		expect([...cob[0].lines]).toEqual([[1, 2], [2, 1]]);
	});

	it("turns the file names a report uses into paths of the workspace", () => {
		expect(workspacePathOf("C:\\w\\ws", "app", "src/a.ts")).toBe("projects/app/src/a.ts");
		expect(workspacePathOf("C:\\w\\ws", "app", "./src/a.ts")).toBe("projects/app/src/a.ts");
		expect(workspacePathOf("C:\\w\\ws", "app", "C:/w/ws/projects/app/src/a.ts")).toBe("projects/app/src/a.ts");
		expect(workspacePathOf("C:\\w\\ws", "app", "/home/me/ws/projects/app/src/a.ts")).toBe("projects/app/src/a.ts");
	});
});
