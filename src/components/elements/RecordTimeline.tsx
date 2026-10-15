// Replays how a task or card got its values: a slider over the moments it changed, the fields as they were then, and a lane
// for each writer showing when their writes were stamped. A write marked "later" reached this device long after it was
// made, which is what writing while apart looks like.

import { useEffect, useMemo, useState } from "react";
import { History } from "@/components/animate-icons";

import { fieldName } from "@/components/elements/ConflictPanel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
import { arrivedLate, laneOf, parseValue, stops, valuesAt, type LoggedWrite } from "@/lib/timescrub";
import { recordHistory } from "@/lib/tauri";
import { colorOf } from "@/lib/collabColor";
import { cn } from "@/lib/utils";

interface Props {
	workspacePath: string;
	entity: "task" | "card";
	id: string;
	title: string;
	show: (field: string, value: unknown) => string;
}

const when = (ts: number) => new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function RecordTimeline({ workspacePath, entity, id, title, show }: Props) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button type="button" variant="outline" size="sm" onPress={() => setOpen(true)}>
				<History className="size-3.5" />
				How It Got Here
			</Button>
			{open && <Replay workspacePath={workspacePath} entity={entity} id={id} title={title} show={show} onClose={() => setOpen(false)} />}
		</>
	);
}

function Replay({ workspacePath, entity, id, title, show, onClose }: Props & { onClose: () => void }) {
	const [log, setLog] = useState<LoggedWrite[] | null>(null);
	const [at, setAt] = useState(0);
	useEffect(() => {
		let live = true;
		recordHistory(workspacePath, entity, id)
			.then((l) => {
				if (!live) return;
				setLog(l);
				setAt(Math.max(0, stops(l).length - 1));
			})
			.catch(() => live && setLog([]));
		return () => {
			live = false;
		};
	}, [workspacePath, entity, id]);

	const moments = useMemo(() => (log ? stops(log) : []), [log]);
	const now = moments[Math.min(at, moments.length - 1)] ?? 0;
	const fields = useMemo(() => (log ? [...valuesAt(log, now).entries()].sort((a, b) => a[0].localeCompare(b[0])) : []), [log, now]);
	const lanes = useMemo(() => [...new Set((log ?? []).map(laneOf))], [log]);
	const first = moments[0] ?? 0;
	const span = Math.max(1, (moments[moments.length - 1] ?? 0) - first);

	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="sm:max-w-2xl">
			<div className="flex max-h-[80vh] min-h-0 flex-col gap-4">
				<DialogHeading icon={<History className="size-6" />} title="How It Got Here" description={`Every change this device has seen to “${title}”, in the order they were made.`} />
				{log === null ? (
					<p className="text-sm text-muted-foreground">Loading…</p>
				) : moments.length === 0 ? (
					<p className="text-sm text-muted-foreground">Nothing was recorded for this yet. Changes from now on will appear here.</p>
				) : (
					<>
						<div className="space-y-1">
							<input
								type="range"
								min={0}
								max={moments.length - 1}
								value={Math.min(at, moments.length - 1)}
								aria-label="Moment in the history"
								aria-valuetext={when(now)}
								onChange={(e) => setAt(Number(e.target.value))}
								className="w-full cursor-pointer"
							/>
							<p className="font-mono text-[13px] text-muted-foreground">
								{when(now)} · change {Math.min(at, moments.length - 1) + 1} of {moments.length}
							</p>
						</div>

						<section aria-label="Writers over time" className="space-y-1">
							{lanes.map((lane) => (
								<div key={lane} className="flex items-center gap-2">
									<span className="w-24 shrink-0 truncate text-[13px]" title={lane}>
										{lane}
									</span>
									<div className="relative h-5 flex-1 bg-muted/40">
										{(log ?? [])
											.filter((w) => laneOf(w) === lane)
											.map((w, i) => (
												<button
													key={i}
													type="button"
													aria-label={`${lane} changed ${fieldName(w.path)} at ${when(w.ts)}${arrivedLate(w) ? ", reached this device later" : ""}`}
													title={`${fieldName(w.path)} · ${when(w.ts)}${arrivedLate(w) ? " · reached this device later" : ""}`}
													onClick={() => setAt(moments.indexOf(w.ts))}
													style={{ left: `${((w.ts - first) / span) * 100}%`, background: colorOf(lane) }}
													className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full", arrivedLate(w) && "ring-2 ring-warning", w.ts === now && "outline outline-2 outline-foreground")}
												/>
											))}
									</div>
								</div>
							))}
							<p className="text-[13px] text-muted-foreground">A ringed dot reached this device long after it was made: written while apart.</p>
						</section>

						<ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto border">
							{fields.map(([path, w]) => (
								<li key={path} className={cn("flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm", w.ts === now && "bg-primary/10")}>
									<span className="text-muted-foreground">{fieldName(path)}</span>
									<span className="min-w-0 break-words">{show(path, parseValue(w.value)) || "(empty)"}</span>
									<span className="basis-full font-mono text-[13px] text-muted-foreground">
										{laneOf(w)}, {when(w.ts)}
										{arrivedLate(w) ? " · reached this device later" : ""}
									</span>
								</li>
							))}
						</ul>
					</>
				)}
			</div>
		</Dialog>
	);
}
