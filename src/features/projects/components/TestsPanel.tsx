import { useCallback, useEffect, useMemo, useState } from "react";

import BisectPanel from "@/features/projects/components/BisectPanel";
import { Check, CircleCheck, Play, RefreshCw, X } from "@/components/animate-icons";
import { Panel } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { parseCobertura, parseLcov, percent, setCoverage, type FileCoverage } from "@/features/projects/lib/coverage";
import type { Run } from "@/features/projects/lib/projectRuns";
import { parseJunit, parseTrx } from "@/features/projects/lib/reportFiles";
import { impactArgs, lastGreen, unstable, type Unstable } from "@/features/projects/lib/testImpact";
import { projectReadReport, projectReports, projectRunLog, projectRuns, projectTestImpact } from "@/lib/tauri";
import { parseTests, runOneArgs, type TestCase, type TestReport } from "@/features/projects/lib/testResults";
import { cn, errorText } from "@/lib/utils";
import type { Impact, ReportFile, TaskSpec } from "@/features/projects/types";

export const TESTS_TO_CHAT = "nexsync.testsToChat";
export const readToChat = () => {
	try {
		return localStorage.getItem(TESTS_TO_CHAT) === "1";
	} catch {
		return false;
	}
};

// The newest run whose output is a test report, with its report
export function latestReport(runs: Run[]) {
	for (const run of runs) {
		const report = parseTests(run.lines.map((l) => l.text));
		if (report) return { run, report };
	}
	return null;
}

const KINDS: Record<ReportFile["kind"], string> = { junit: "JUnit results", trx: "Visual Studio results", lcov: "lcov coverage", cobertura: "Cobertura coverage" };

// What the last test run said, test by test (from its output, or from a report file it wrote), and the coverage reports a run
// left: failures first with their messages, a button to run just one test, and the lines the tests reached shaded in the editor.
// The person's own failures can be posted to a channel (off unless chosen here).
export default function TestsPanel({ path, project, runs, tasks, canRun, onRunOne, onOpenFile }: { path: string; project: string; runs: Run[]; tasks: TaskSpec[]; canRun: boolean; onRunOne: (taskId: string, args: string[]) => void; onOpenFile: (rel: string) => void }) {
	const found = useMemo(() => latestReport(runs), [runs]);
	const [failedOnly, setFailedOnly] = useState(false);
	const [toChat, setToChat] = useState(readToChat);
	const [files, setFiles] = useState<ReportFile[]>([]);
	const [fromFile, setFromFile] = useState<{ name: string; report: TestReport } | null>(null);
	const [coverage, setCoverageList] = useState<{ name: string; files: FileCoverage[] } | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [impact, setImpact] = useState<Impact | null>(null);
	const [shaky, setShaky] = useState<Unstable[]>([]);
	const [green, setGreen] = useState(0);
	const [failing, setFailing] = useState(false);
	const testTask = tasks.find((t) => t.id === "test");
	const finished = runs.filter((r) => r.status === "done").length;

	// Which test files the changes since the last passing run can reach, and which tests went back and forth in recent runs
	useEffect(() => {
		if (!testTask) return;
		let live = true;
		void projectRuns(path, project)
			.then(async (history) => {
				const tests = history.filter((h) => h.task === testTask.id).slice(0, 10).reverse();
				const reports = (await Promise.all(tests.map((h) => projectRunLog(path, h.runId).then((t) => parseTests(t.split("\n"))).catch(() => null)))).filter((r): r is TestReport => !!r);
				const since = lastGreen(history, testTask.id);
				const found = await projectTestImpact(path, project, since);
				if (live) {
					setGreen(since);
					// The newest finished run of the task did not pass
					const newest = history.find((h) => h.task === testTask.id && !h.stopped);
					setFailing(!!newest && newest.code !== 0);
					setImpact(found);
					setShaky(unstable(reports));
				}
			})
			.catch(() => live && setImpact(null));
		return () => {
			live = false;
		};
	}, [path, project, testTask?.id, finished]);
	const impactCommand = testTask ? impactArgs(testTask.command, impact?.language ?? "other", impact?.tests ?? []) : null;

	const look = useCallback(() => {
		projectReports(path, project).then(setFiles).catch(() => setFiles([]));
	}, [path, project]);
	useEffect(look, [look, runs.filter((r) => r.status === "done").length]);

	const open = async (f: ReportFile) => {
		setMessage(null);
		try {
			const text = await projectReadReport(path, project, f.path);
			if (f.kind === "junit" || f.kind === "trx") {
				const report = f.kind === "junit" ? parseJunit(text) : parseTrx(text);
				if (!report) return setMessage("No tests could be read from that file.");
				setFromFile({ name: f.path, report });
			} else {
				const list = f.kind === "lcov" ? parseLcov(text) : parseCobertura(text);
				if (list.length === 0) return setMessage("No coverage could be read from that file.");
				setCoverage(path, project, list);
				setCoverageList({ name: f.path, files: list });
			}
		} catch (err) {
			setMessage(errorText(err, "That report could not be read."));
		}
	};

	const shownReport = fromFile?.report ?? found?.report ?? null;
	const run = fromFile ? null : (found?.run ?? null);
	const command = run ? (tasks.find((t) => t.id === run.task)?.command ?? "") : "";
	const order: Record<TestCase["status"], number> = { fail: 0, pass: 1, skip: 2 };
	const shown = (shownReport?.tests ?? []).filter((t) => !failedOnly || t.status === "fail").sort((a, b) => order[a.status] - order[b.status]);

	return (
		<div className="space-y-4">
			{message && (
				<p role="alert" className="bg-destructive/10 p-2 text-sm text-destructive">
					{message}
				</p>
			)}
			{testTask && impact && canRun && (
				<Panel title="After Your Changes" hint={impact.everything ? "everything" : `${impact.tests.length} of ${impact.tests.length + impact.skipped} test files`}>
					<div className="flex flex-wrap items-center gap-3 text-sm">
						<span className="min-w-0 flex-1 text-muted-foreground">
							{impact.why}
							{!impact.everything && impact.tests.length === 0 && " None of the test files reaches them, so none needs to run again."}
							{!impact.everything && impact.skipped > 0 && ` ${impact.skipped} test ${impact.skipped === 1 ? "file" : "files"} cannot reach them and ${impact.skipped === 1 ? "is" : "are"} skipped. This is a guess from the imports between files.`}
						</span>
						{!impact.everything && impactCommand && (
							<Button variant="outline" size="xs" onPress={() => onRunOne(testTask.id, impactCommand)}>
								<Play className="size-3" />
								Run {impact.tests.length} Affected
							</Button>
						)}
						<Button variant="ghost" size="xs" onPress={() => onRunOne(testTask.id, [])}>
							Run All
						</Button>
					</div>
				</Panel>
			)}
			{testTask && canRun && failing && <BisectPanel path={path} project={project} taskId={testTask.id} taskLabel={testTask.label} since={green} onOpen={onOpenFile} />}
			{shaky.length > 0 && (
				<Panel title="Unstable Tests" hint={String(shaky.length)} flush>
					<ul className="divide-y">
						{shaky.slice(0, 10).map((u) => (
							<li key={u.name} className="flex items-center gap-3 px-4 py-2">
								<span className="min-w-0 flex-1 truncate text-sm">{u.name}</span>
								<span className="font-mono text-[13px] text-muted-foreground">
									failed {u.fails} of {u.runs} runs · changed {u.flips} times
								</span>
							</li>
						))}
					</ul>
					<p className="px-4 py-2 text-[13px] text-muted-foreground">These passed and failed in turn across the last runs on this device. A test that was broken and fixed twice looks the same.</p>
				</Panel>
			)}
			{!shownReport ? (
				<p className="text-sm text-muted-foreground">No test results yet. Run the project's tests from the Overview tab: results appear here when the runner's output can be read (Jest and Vitest as JSON, go test, cargo test, pytest -v and TAP). A report file a run wrote (JUnit XML or TRX) can be opened below. Other output stays in the Output tab as text.</p>
			) : (
				<Panel
					title="Test Results"
					hint={`${shownReport.passed} passed, ${shownReport.failed} failed${shownReport.skipped ? `, ${shownReport.skipped} skipped` : ""}`}
					flush
					right={
						<>
							{fromFile && (
								<Button variant="ghost" size="xs" onPress={() => setFromFile(null)}>
									Back to the Last Run
								</Button>
							)}
							<Button variant="ghost" size="xs" aria-pressed={failedOnly} onPress={() => setFailedOnly((v) => !v)}>
								{failedOnly ? "Show All" : "Failed Only"}
							</Button>
						</>
					}
				>
					<div className="flex flex-wrap items-center gap-3 border-b px-4 py-2 text-[13px] text-muted-foreground">
						<span className="font-mono">{fromFile ? fromFile.name : `${run?.task} · ${run?.status === "done" ? "finished" : "running"}`}</span>
						<span className="flex-1" />
						<label className="flex cursor-pointer items-center gap-2">
							<input
								type="checkbox"
								checked={toChat}
								onChange={(e) => {
									setToChat(e.target.checked);
									try {
										localStorage.setItem(TESTS_TO_CHAT, e.target.checked ? "1" : "0");
									} catch {
										// Not remembered this time
									}
								}}
							/>
							Tell the team in Chat when my tests fail
						</label>
					</div>
					<ul className="divide-y">
						{shown.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">Nothing failed.</li>}
						{shown.map((t, i) => {
							const args = run ? runOneArgs(shownReport.runner, command, t) : null;
							return (
								<li key={`${t.file ?? ""}${t.name}${i}`} className="px-4 py-3">
									<div className="flex items-center gap-3">
										{t.status === "pass" ? <CircleCheck className="size-4 shrink-0 text-success" /> : t.status === "fail" ? <X className="size-4 shrink-0 text-destructive" /> : <Check className="size-4 shrink-0 text-muted-foreground" />}
										<span className="min-w-0 flex-1">
											<span className={cn("block truncate text-sm", t.status === "skip" && "text-muted-foreground")}>{t.name}</span>
											{t.file && <span className="block truncate font-mono text-[13px] text-muted-foreground">{t.file}</span>}
										</span>
										{canRun && run && args && (
											<Button variant="outline" size="xs" onPress={() => onRunOne(run.task, args)}>
												<Play className="size-3" />
												Run This Test
											</Button>
										)}
									</div>
									{t.message && <pre className="mt-2 max-h-48 overflow-auto bg-destructive/10 p-2 font-mono text-[13px] whitespace-pre-wrap">{t.message}</pre>}
								</li>
							);
						})}
					</ul>
				</Panel>
			)}

			<Panel title="Report Files" hint={files.length ? String(files.length) : undefined} flush={files.length > 0} right={<Button variant="ghost" size="icon-xs" aria-label="Look again" onPress={look}><RefreshCw className="size-3.5" /></Button>}>
				{files.length === 0 ? (
					<p className="text-sm text-muted-foreground">No report files found in this project. Test runs can write JUnit XML or TRX, and coverage runs lcov or Cobertura; they show up here, newest first.</p>
				) : (
					<ul className="divide-y">
						{files.map((f) => (
							<li key={f.path} className="flex items-center gap-3 px-4 py-2">
								<span className="min-w-0 flex-1">
									<span className="block truncate font-mono text-sm">{f.path}</span>
									<span className="block text-[13px] text-muted-foreground">
										{KINDS[f.kind]} · {new Date(f.modified).toLocaleString()}
									</span>
								</span>
								<Button variant="outline" size="xs" onPress={() => void open(f)}>
									{f.kind === "lcov" || f.kind === "cobertura" ? "Show Coverage" : "Show Results"}
								</Button>
							</li>
						))}
					</ul>
				)}
			</Panel>

			{coverage && (
				<Panel title="Coverage" hint={coverage.name} flush>
					<p className="border-b px-4 py-2 text-[13px] text-muted-foreground">Open a file in the Editor to see which of its lines the tests reached: green bars in the gutter ran, red ones did not.</p>
					<ul className="divide-y">
						{[...coverage.files].sort((a, b) => percent(a) - percent(b)).map((f) => (
							<li key={f.file} className="flex items-center gap-3 px-4 py-2">
								<span className="min-w-0 flex-1 truncate font-mono text-sm">{f.file}</span>
								<span className="h-2 w-24 shrink-0 bg-muted" role="img" aria-label={`${percent(f)}% of lines reached`}>
									<span className={cn("block h-full", percent(f) >= 80 ? "bg-success" : percent(f) >= 50 ? "bg-warning" : "bg-destructive")} style={{ width: `${percent(f)}%` }} />
								</span>
								<span className="w-10 shrink-0 text-right font-mono text-[13px] tabular-nums">{percent(f)}%</span>
							</li>
						))}
					</ul>
				</Panel>
			)}
		</div>
	);
}
