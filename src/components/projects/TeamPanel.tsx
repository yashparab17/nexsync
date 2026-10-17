import { Check, Users } from "@/components/animate-icons";
import { Panel } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { checklist, diffTools, mixedNote, toolsDiffer, type EnvShare, type Member, type ReproShare, type RunShare } from "@/lib/teamStatus";

const when = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

// The project as the team has it: whose tools differ, how far each person got with setting up, and who is running what.
// Everything here is what members chose to share from their own devices.
export default function TeamPanel({
	me,
	envs,
	runs,
	failures,
	myTools,
	recipe,
	sharing,
	canShare,
	onShare,
}: {
	me: string;
	envs: Member<EnvShare>[];
	runs: Member<RunShare>[];
	failures: Member<ReproShare>[];
	myTools: EnvShare["tools"];
	recipe: { server: string[]; tests: boolean; install: boolean };
	sharing: boolean;
	canShare: boolean;
	onShare: (on: boolean) => void;
}) {
	const rows = diffTools(envs);
	const people = [...new Map([...envs, ...runs].map((m) => [m.key, m.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
	const envOf = (k: string) => envs.find((m) => m.key === k)?.data;
	const runOf = (k: string) => runs.find((m) => m.key === k)?.data;

	return (
		<div className="grid gap-4 @4xl:grid-cols-2">
			<div role="status" className="flex flex-wrap items-center gap-3 bg-muted/40 p-3 text-sm @4xl:col-span-2">
				<Users className="size-4 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1">{sharing ? "Your tool versions and what you run in this project are shared with the workspace. Only names and versions, never output, files or variables." : "Nothing is shared. Turn it on to see how your setup compares with the team's, and to let them see what you have running."}</span>
				{canShare && (
					<Button variant={sharing ? "outline" : "default"} size="sm" onPress={() => onShare(!sharing)}>
						{sharing ? "Stop Sharing" : "Share My Setup"}
					</Button>
				)}
			</div>

			<Panel title="Tools Side by Side" hint={rows.some((r) => r.mixed) ? `${rows.filter((r) => r.mixed).length} differ` : undefined} flush={rows.length > 0}>
				{rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">No one has shared their tools for this project yet.</p>
				) : (
					<ul className="divide-y">
						{rows.map((r) => (
							<li key={r.tool} className="px-4 py-3">
								<div className="flex items-center gap-2">
									<span className={cn("size-2 shrink-0 rounded-full", r.mixed ? "bg-warning" : "bg-success")} aria-hidden />
									<span className="font-mono text-sm">{r.tool}</span>
									{r.range && <span className="font-mono text-[13px] text-muted-foreground">{r.range}</span>}
								</div>
								<p className="mt-1 text-[13px] text-muted-foreground">{mixedNote(r, envs.find((m) => m.key === me)?.name ?? "") ?? `Everyone has ${r.groups[0].version}`}</p>
								{r.mixed && (
									<ul className="mt-1 space-y-0.5 text-[13px]">
										{r.groups.map((g) => (
											<li key={g.version} className="flex gap-2">
												<span className="w-20 shrink-0 font-mono">{g.version}</span>
												<span className="min-w-0 truncate text-muted-foreground">{g.people.join(", ")}</span>
											</li>
										))}
									</ul>
								)}
							</li>
						))}
					</ul>
				)}
			</Panel>

			<Panel title="Getting Started" hint="from the recipe" flush={people.length > 0}>
				{people.length === 0 ? (
					<p className="text-sm text-muted-foreground">Appears when someone shares their setup.</p>
				) : (
					<ul className="divide-y">
						{people.map(([key, name]) => {
							const steps = checklist(envOf(key), runOf(key), recipe);
							return (
								<li key={key} className="px-4 py-3">
									<div className="flex items-center gap-2 text-sm font-medium">
										<span className="min-w-0 flex-1 truncate">
											{name}
											{key === me && <span className="text-muted-foreground"> (you)</span>}
										</span>
										<span className="font-mono text-[13px] text-muted-foreground">
											{steps.filter((s) => s.done).length}/{steps.length}
										</span>
									</div>
									<ul className="mt-1 space-y-0.5">
										{steps.map((s) => (
											<li key={s.id} className={cn("flex items-center gap-2 text-[13px]", s.done ? "text-muted-foreground" : "")}>
												{s.done ? <Check className="size-3.5 text-success" /> : <span className="size-3.5 text-center text-muted-foreground">·</span>}
												{s.label}
											</li>
										))}
									</ul>
								</li>
							);
						})}
					</ul>
				)}
			</Panel>

			<Panel title="Shared Failures" hint={failures.length ? String(failures.length) : undefined} className="@4xl:col-span-2" flush={failures.length > 0}>
				{failures.length === 0 ? (
					<p className="text-sm text-muted-foreground">When a task fails for someone, they can share its output and their tools here, with Share Failure on the Output tab.</p>
				) : (
					<ul className="divide-y">
						{failures.slice(0, 20).map((f) => {
							const diff = toolsDiffer(f.data.tools ?? [], myTools);
							return (
								<li key={`${f.key}${f.ts}`}>
									<details className="group px-4 py-3">
										<summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 text-sm outline-none focus-visible:bg-muted">
											<span className="size-2 shrink-0 rounded-full bg-destructive" aria-hidden />
											<span className="min-w-0 flex-1 truncate">
												<span className="font-medium">{f.name}</span> · {f.data.task} ended with code {f.data.code ?? "none"}
											</span>
											<span className="font-mono text-[13px] text-muted-foreground">{when(f.ts)}</span>
										</summary>
										<div className="mt-2 space-y-2">
											<p className="font-mono text-[13px] text-muted-foreground">{f.data.command}</p>
											{diff.length > 0 && <p className="text-[13px] text-warning">Tools that differ from yours: {diff.map((d) => `${d.tool} ${d.theirs} (you ${d.mine})`).join(", ")}</p>}
											{f.data.problems?.length > 0 && (
												<ul className="text-[13px]">
													{f.data.problems.map((p, i) => (
														<li key={i} className="truncate">
															<span className="font-mono text-muted-foreground">{p.file}:{p.line}</span> {p.message}
														</li>
													))}
												</ul>
											)}
											<pre className="max-h-72 overflow-auto bg-muted/40 p-2 font-mono text-[13px] whitespace-pre-wrap break-all">{f.data.cut ? "[earlier output is not included]\n" : ""}{f.data.log}</pre>
										</div>
									</details>
								</li>
							);
						})}
					</ul>
				)}
			</Panel>

			<Panel title="Running Now" className="@4xl:col-span-2" flush={runs.length > 0}>
				{runs.length === 0 ? (
					<p className="text-sm text-muted-foreground">No one is sharing what they run.</p>
				) : (
					<ul className="divide-y">
						{runs.map((m) => (
							<li key={m.key} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
								<span className="w-40 min-w-0 shrink-0 truncate font-medium">{m.name}</span>
								<span className="flex min-w-0 flex-1 flex-wrap gap-2">
									{m.data.running.length === 0 ? <span className="text-muted-foreground">nothing running</span> : m.data.running.map((t) => (
										<span key={t} className="flex items-center gap-1.5 bg-muted px-2 py-0.5 font-mono text-[13px]">
											<span className="size-2 rounded-full bg-success" aria-hidden />
											{t}
										</span>
									))}
								</span>
								{m.data.test && (
									<span className={cn("flex items-center gap-1.5 font-mono text-[13px]", m.data.test.ok ? "text-muted-foreground" : "text-destructive")} title={when(m.data.test.at)}>
										<span className={cn("size-2 rounded-full", m.data.test.ok ? "bg-success" : "bg-destructive")} aria-hidden />
										tests {m.data.test.ok ? "passed" : "failed"} {when(m.data.test.at)}
									</span>
								)}
							</li>
						))}
					</ul>
				)}
			</Panel>
		</div>
	);
}
