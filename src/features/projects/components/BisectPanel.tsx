import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import { ExternalLink, Search } from "@/components/animate-icons";
import { Panel } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { diffLines, type DiffResult } from "@/lib/diff";
import { projectBisect, projectBisectCancel, readFileVersion } from "@/lib/tauri";
import { cn, errorText } from "@/lib/utils";
import type { Bisected } from "@/features/projects/types";

const SAYS: Record<Exclude<Bisected["outcome"], "found">, string> = {
	"nothing-recorded": "No saved version of a file in this project is newer than the last passing run, so there is nothing to put back. Edits made by other programs are not in the history.",
	"too-many": "Too many edits since the last pass to search in a few steps. Run the tests once to mark a new starting point.",
	"baseline-fails": "The tests fail even with every file put back as it was at the last pass. Something outside the saved versions changed (a program that edited files, a dependency, the machine), or the tests are unstable.",
	"now-passes": "The tests pass with all the saved edits applied. The failure comes from something that is not in the saved versions, or the tests are unstable.",
	cancelled: "Stopped. Nothing in the project was changed.",
};

// When the tests started failing: the edits since the last passing run are put back one at a time, in a copy, and the task is
// run on halves of the list until one edit is left. Only for a task this device has approved.
export default function BisectPanel({ path, project, taskId, taskLabel, since, onOpen }: { path: string; project: string; taskId: string; taskLabel: string; since: number; onOpen: (rel: string) => void }) {
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState("");
	const [result, setResult] = useState<Bisected | null>(null);
	const [diff, setDiff] = useState<DiffResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const un = listen<{ text: string; step: number; steps: number }>("project://bisect", ({ payload }) => setProgress(`Step ${payload.step} of about ${payload.steps}. ${payload.text}`));
		return () => void un.then((f) => f());
	}, []);

	const find = () => {
		setBusy(true);
		setError(null);
		setResult(null);
		setDiff(null);
		projectBisect(path, project, taskId, since)
			.then(async (r) => {
				setResult(r);
				if (r.culprit) {
					const [before, after] = await Promise.all([r.culprit.beforeId ? readFileVersion(path, r.culprit.beforeId).catch(() => "") : Promise.resolve(""), readFileVersion(path, r.culprit.versionId).catch(() => "")]);
					setDiff(diffLines(before, after));
				}
			})
			.catch((e) => setError(errorText(e, "The search did not run.")))
			.finally(() => {
				setBusy(false);
				setProgress("");
			});
	};

	const c = result?.culprit;
	return (
		<Panel
			title="Which Edit Broke It"
			icon={<Search />}
			right={
				busy ? (
					<Button variant="outline" size="xs" onPress={() => void projectBisectCancel()}>
						Stop
					</Button>
				) : (
					<Button variant="outline" size="xs" onPress={find}>
						Find It
					</Button>
				)
			}
		>
			<div className="space-y-3 text-sm">
				{!result && !busy && !error && (
					<p className="text-muted-foreground">
						Puts the files saved since {since ? "the last passing run" : "the beginning"} back one edit at a time in a scratch copy and runs <span className="font-mono">{taskLabel}</span> on each half of the list, to find the first edit after which it fails. Your project is not touched. It uses the versions kept on this device, so it does not see edits made by other programs and does not know who made an edit.
					</p>
				)}
				{busy && (
					<p role="status" className="text-muted-foreground">
						{progress || "Making a copy..."}
					</p>
				)}
				{error && (
					<p role="alert" className="bg-destructive/10 p-2 text-destructive">
						{error}
					</p>
				)}
				{result && result.outcome !== "found" && <p className="text-muted-foreground">{SAYS[result.outcome]}</p>}
				{c && (
					<div className="space-y-2">
						<p>
							The tests first fail after the edit to <span className="font-mono">{c.path}</span> at {new Date(c.createdAt).toLocaleString()}, {c.source === "sync" ? "which arrived from another device" : c.source === "auto" ? "an automatic snapshot of your own editing" : c.source === "named" ? `a version named "${c.label ?? ""}"` : "saved on this device"}. {result?.edits} edits were tried in {result?.steps.length} runs.
						</p>
						<Button variant="outline" size="xs" onPress={() => onOpen(c.path)}>
							<ExternalLink className="size-3" />
							Open {c.path.split("/").pop()}
						</Button>
						{diff && !diff.identical && (
							<pre className="max-h-72 overflow-auto bg-muted/40 p-2 font-mono text-[13px]">
								{diff.rows
									.filter((r, i, all) => r.kind !== "same" || all.slice(Math.max(0, i - 2), i + 3).some((x) => x.kind !== "same"))
									.map((r, i) => (
										<div key={i} className={cn("whitespace-pre-wrap break-all", r.kind === "add" && "bg-success/10 text-success", r.kind === "del" && "bg-destructive/10 text-destructive")}>
											{r.kind === "add" ? "+ " : r.kind === "del" ? "- " : "  "}
											{r.text}
										</div>
									))}
							</pre>
						)}
						{result && result.log && (
							<details>
								<summary className="cursor-pointer text-muted-foreground">Output of the failing run</summary>
								<pre className="mt-1 max-h-60 overflow-auto bg-muted/40 p-2 font-mono text-[13px] whitespace-pre-wrap break-all">{result.log}</pre>
							</details>
						)}
					</div>
				)}
				{result && result.steps.length > 0 && (
					<ul className="font-mono text-[13px] text-muted-foreground">
						{result.steps.map(([label, ok], i) => (
							<li key={i}>
								{ok ? "pass" : "FAIL"} · {label}
							</li>
						))}
					</ul>
				)}
			</div>
		</Panel>
	);
}
