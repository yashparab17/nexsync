// Test reports that runners write to a file: JUnit XML (Maven, Gradle, pytest --junitxml, jest-junit, many more) and Visual Studio's
// TRX (dotnet test). Read with the browser's own XML parser, which does not run anything in the file.

import type { TestCase, TestReport } from "@/features/projects/lib/testResults";

const MESSAGE_LINES = 12;
const cut = (text: string | null | undefined) => (text ?? "").split("\n").slice(0, MESSAGE_LINES).join("\n").trim() || undefined;

function parse(xml: string): Document | null {
	const doc = new DOMParser().parseFromString(xml, "application/xml");
	return doc.getElementsByTagName("parsererror").length > 0 ? null : doc;
}

const report = (tests: TestCase[]): TestReport | null =>
	tests.length === 0 ? null : { runner: "tap", tests, passed: tests.filter((t) => t.status === "pass").length, failed: tests.filter((t) => t.status === "fail").length, skipped: tests.filter((t) => t.status === "skip").length };

// <testcase classname name><failure|error message>text</failure><skipped/></testcase>
export function parseJunit(xml: string): TestReport | null {
	const doc = parse(xml);
	if (!doc) return null;
	const tests: TestCase[] = [];
	for (const c of Array.from(doc.getElementsByTagName("testcase"))) {
		const fail = c.getElementsByTagName("failure")[0] ?? c.getElementsByTagName("error")[0];
		const skipped = c.getElementsByTagName("skipped")[0];
		const cls = c.getAttribute("classname") ?? "";
		tests.push({
			name: c.getAttribute("name") ?? "(unnamed)",
			file: c.getAttribute("file") ?? (cls || undefined),
			status: fail ? "fail" : skipped ? "skip" : "pass",
			message: fail ? cut(fail.textContent || fail.getAttribute("message")) : undefined,
		});
	}
	// Reports from a runner Nexsync cannot run one test of: no runner, so no Run This Test
	return report(tests);
}

// <UnitTestResult testName outcome="Passed|Failed|NotExecuted"><Output><ErrorInfo><Message>
export function parseTrx(xml: string): TestReport | null {
	const doc = parse(xml);
	if (!doc) return null;
	const tests: TestCase[] = [];
	for (const r of Array.from(doc.getElementsByTagName("UnitTestResult"))) {
		const outcome = r.getAttribute("outcome");
		tests.push({
			name: r.getAttribute("testName") ?? "(unnamed)",
			status: outcome === "Passed" ? "pass" : outcome === "Failed" ? "fail" : "skip",
			message: outcome === "Failed" ? cut(r.getElementsByTagName("Message")[0]?.textContent) : undefined,
		});
	}
	return report(tests);
}
