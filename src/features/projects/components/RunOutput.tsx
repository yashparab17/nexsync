import { memo, useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";

import { AlertTriangle, Copy, Download, ExternalLink, Play, RefreshCw, Trash2, X } from "@/components/animate-icons";
import { ToolbarSearch } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import { ansiPieces, plain } from "@/lib/ansi";
import { forgetRun, mergeRuns, type Run, type RunLine } from "@/features/projects/lib/projectRuns";
import { projectRunLog, projectRuns, projectTaskStop, writeExportText } from "@/lib/tauri";
import { cn, errorText, formatBytes } from "@/lib/utils";
import type { RunRecord } from "@/features/projects/types";

// One line of output. Lines are added at the end and never change, so a memoised row is drawn once, however many follow it.
const Line = memo(function Line({ text, stderr, label, color }: { text: string; stderr: boolean; label?: string; color?: string }) {
	return (
		<div className={cn("break-all whitespace-pre-wrap", stderr && "text-warning")}>
			{label && <span className={cn("mr-2 select-none font-medium", color)}>{label}</span>}
			{ansiPieces(text).map((p, j) => (
				<span key={j} className={p.className}>
					{p.text}
				</span>
			))}
		</div>
	);
});

// Each task of the merged view keeps one colour, so a stream of several is easy to follow
const COLORS = ["text-sky-500", "text-emerald-500", "text-amber-500", "text-fuchsia-500", "text-cyan-500", "text-rose-500"];
const colorOf = (task: string) => COLORS[[...task].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length];
const ALL = "*";

const stateText = (r: Run) => (r.status === "done" ? (r.stopped ? "stopped" : r.error ? "could not start" : r.code === 0 ? "finished" : `ended with code ${r.code ?? "none"}`) : r.status === "ready" ? "running" : "starting");

// The output of a project's runs: one tab per run, the lines with their colours, a filter, copy and save, the ports a run opened
// (with a note when one is open to the whole network) and the runs kept from earlier
export default function RunOutput({ workspacePath, project, runs, onRerun, onOpenUrl, onShare }: { workspacePath: string; project: string; runs: Run[]; onRerun: (task: string) => void; onOpenUrl: (port: number) => void; onShare?: (run: Run) => Promise<void> }) {
	const [picked, setPicked] = useState<string | null>(null);
	const [filter, setFilter] = useState("");
	const [history, setHistory] = useState<RunRecord[] | null>(null);
	const [earlier, setEarlier] = useState<{ title: string; lines: string[] } | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	// With more than one run there is a view of all of them together (the process manager's merged log)
	const merged = picked === ALL && runs.length > 1 && !earlier;
	const run = merged ? null : (runs.find((r) => r.runId === picked) ?? runs[0] ?? null);
	const box = useRef<HTMLDivElement>(null);
	const stick = useRef(true);
	const mergedLines = useMemo(() => (merged ? mergeRuns(runs) : []), [merged, runs]);
	const lines: RunLine[] = useMemo(() => (merged ? mergedLines.map((m) => m.line) : earlier ? earlier.lines.map((text) => ({ stream: "stdout" as const, text })) : (run?.lines ?? [])), [merged, mergedLines, earlier, run?.lines]);

	const shown = useMemo(() => {
		const q = filter.trim().toLowerCase();
		return q ? lines.filter((l) => plain(l.text).toLowerCase().includes(q)) : lines;
	}, [lines, filter]);
	// The task of each shown line in the merged view (the filter keeps the order, so it is found by identity)
	const taskOf = useMemo(() => new Map(mergedLines.map((m) => [m.line, m.task])), [mergedLines]);

	// Stay at the bottom while output arrives, unless the person scrolled up to read
	useEffect(() => {
		const el = box.current;
		if (el && stick.current) el.scrollTop = el.scrollHeight;
	}, [shown.length]);

	const text = () => shown.map((l) => plain(l.text)).join("\n");
	const flash = (m: string) => {
		setNotice(m);
		setTimeout(() => setNotice(null), 3000);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
					{runs.length > 1 && (
						<button type="button" onClick={() => { setEarlier(null); setPicked(ALL); }} aria-current={merged} className={cn("flex items-center gap-2 px-3 py-1.5 text-sm outline-none focus-visible:bg-muted", merged ? "bg-muted" : "text-muted-foreground hover:bg-muted")}>
							All Together
						</button>
					)}
					{runs.map((r) => (
					<button
						key={r.runId}
						type="button"
						onClick={() => {
							setEarlier(null);
							setPicked(r.runId);
						}}
						aria-current={!earlier && !merged && r.runId === run?.runId}
							className={cn("flex items-center gap-2 px-3 py-1.5 text-sm outline-none focus-visible:bg-muted", !earlier && !merged && r.runId === run?.runId ? "bg-muted" : "text-muted-foreground hover:bg-muted")}
					>
						<span className={cn("size-2 rounded-full", r.status === "done" ? (r.code === 0 ? "bg-muted-foreground/50" : "bg-destructive") : "bg-success")} aria-hidden />
						{r.task}
					</button>
				))}
				<span className="flex-1" />
				<Button variant="ghost" size="xs" onPress={() => void projectRuns(workspacePath, project).then(setHistory).catch(() => setHistory([]))}>
					Earlier Runs
				</Button>
			</div>

			{history && (
				<ul className="max-h-40 divide-y overflow-auto bg-muted/40">
					{history.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No earlier runs on this device.</li>}
					{history.map((h) => (
						<li key={h.runId}>
							<button
								type="button"
								onClick={() =>
									void projectRunLog(workspacePath, h.runId)
										.then((t) => setEarlier({ title: h.task, lines: t.split("\n") }))
										.catch((e) => flash(errorText(e, "That output was not kept.")))
								}
								className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
							>
								<span className="min-w-0 flex-1 truncate">{h.task}</span>
								<span className="font-mono text-[13px] text-muted-foreground">
									{h.stopped ? "stopped" : h.code === 0 ? "finished" : `code ${h.code ?? "none"}`} · {(h.durationMs / 1000).toFixed(1)}s · {new Date(h.started).toLocaleString()}
								</span>
							</button>
						</li>
					))}
				</ul>
			)}

				{!run && !earlier && !merged ? (
				<p className="text-sm text-muted-foreground">Nothing has run yet. Start a task from the Overview tab and its output appears here.</p>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<span className="min-w-0 truncate text-sm font-medium">{merged ? "All running tasks together" : earlier ? `${earlier.title} (earlier run)` : run?.task}</span>
						{run && !earlier && (
							<span className="font-mono text-[13px] text-muted-foreground">
								{stateText(run)}
								{run.restarts > 0 && `, restarted ${run.restarts}`}
							</span>
						)}
						{run &&
							!earlier &&
							run.ports.map((p) => (
								<span key={p.port} className="flex items-center gap-1">
									<Button variant="outline" size="xs" onPress={() => onOpenUrl(p.port)}>
										<ExternalLink className="size-3" />
										localhost:{p.port}
									</Button>
									{p.open && (
										<span title="This address is open to everyone on the network, not only this device" className="flex items-center gap-1 text-[13px] text-warning">
											<AlertTriangle className="size-3.5" />
											open to the network
										</span>
									)}
								</span>
							))}
						<span className="flex-1" />
						<ToolbarSearch label="Filter the output" value={filter} onChange={setFilter} placeholder="Filter" className="w-40" />
						<Button variant="ghost" size="icon-xs" aria-label="Copy the output" onPress={() => void navigator.clipboard?.writeText(text()).then(() => flash("Copied."))}>
							<Copy className="size-3.5" />
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label="Save the output"
							onPress={() =>
								void save({ title: "Save the output", defaultPath: `${run?.task ?? "output"}.txt`, filters: [{ name: "Text", extensions: ["txt"] }] })
									.then(async (dest) => {
										if (!dest) return;
										await writeExportText(workspacePath, dest, text());
										flash("Saved.");
									})
									.catch((e) => flash(errorText(e, "Could not save.")))
							}
						>
							<Download className="size-3.5" />
						</Button>
						{run && !earlier && run.status !== "done" && (
							<Button variant="outline" size="xs" onPress={() => void projectTaskStop(run.runId)}>
								<X className="size-3" />
								Stop
							</Button>
						)}
						{run && !earlier && run.status === "done" && (
							<>
								<Button variant="outline" size="xs" onPress={() => onRerun(run.task)}>
									<Play className="size-3" />
									Run Again
								</Button>
								{onShare && run.code !== 0 && !run.stopped && !run.error && (
									<Button variant="outline" size="xs" onPress={() => void onShare(run).then(() => flash("Shared. Teammates see it on the Team tab.")).catch((e) => flash(errorText(e, "Could not share.")))}>
										Share Failure
									</Button>
								)}
								<Button variant="ghost" size="icon-xs" aria-label="Remove this run" onPress={() => forgetRun(run.runId)}>
									<Trash2 className="size-3.5" />
								</Button>
							</>
						)}
						{run && !earlier && run.status === "running" && <RefreshCw className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
					</div>
					{notice && (
						<p role="status" className="text-[13px] text-muted-foreground">
							{notice}
						</p>
					)}
					<div
						ref={box}
						onScroll={(e) => {
							const el = e.currentTarget;
							stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
						}}
						role="log"
						aria-label="Output"
						className="min-h-64 flex-1 overflow-auto bg-muted/40 p-3 font-mono text-[13px] leading-5"
					>
						{run && !earlier && run.dropped > 0 && <p className="text-muted-foreground">[{run.dropped.toLocaleString()} earlier lines are not shown; the whole output is kept when the run ends]</p>}
						{shown.map((l, i) => (
							<Line key={i} text={l.text} stderr={l.stream === "stderr"} label={merged ? taskOf.get(l) : undefined} color={merged ? colorOf(taskOf.get(l) ?? "") : undefined} />
						))}
						{shown.length === 0 && <p className="text-muted-foreground">{filter ? "No line matches." : "No output yet."}</p>}
					</div>
					<p className="font-mono text-[13px] text-muted-foreground">{formatBytes(shown.reduce((n, l) => n + l.text.length, 0))} shown</p>
				</>
			)}
		</div>
	);
}
