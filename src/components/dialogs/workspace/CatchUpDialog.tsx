import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, History, ShieldCheck, Undo2 } from "lucide-react";

import { DiffView } from "@/components/dialogs/workspace/FileHistoryDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canRevertField, describe, groupByAuthor, previewText, revertValue, rowKey, rowsOf, textHunks, type Lookups } from "@/lib/catchup";
import { diffLines } from "@/lib/diff";
import { markCatchup, resolveCardConflict, resolveTaskConflict } from "@/lib/tauri";
import { useP2P } from "@/store/p2p/P2PContext";
import type { CatchupEntry } from "@/types/workspace";

interface CatchUpDialogProps {
	workspacePath: string;
	entries: CatchupEntry[];
	lookups: Lookups;
	// The member list, whose device keys say whose a signed change is
	members: { name: string; deviceId?: string }[];
	// Called after anything is reverted or marked reviewed, so the list reloads
	onChanged: () => Promise<void> | void;
	onClose: () => void;
}

const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// What other people changed while this device was not looking, by who did it, with an undo for each change.
// A person's edits to one file are folded into one line, with the detail a click away, so small changes stay small.
export default function CatchUpDialog({ workspacePath, entries, lookups, members, onChanged, onClose }: CatchUpDialogProps) {
	const { publishDataChange, refreshData, revertTextHunk } = useP2P();
	const groups = useMemo(() => groupByAuthor(entries, members), [entries, members]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// Text hunks already undone in this session, as "entry id:hunk number"
	const [undone, setUndone] = useState<Set<string>>(new Set());
	// Folded lines that have been opened, as "author:row key"
	const [opened, setOpened] = useState<Set<string>>(new Set());

	const run = async (work: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await work();
			await onChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	const revertField = (e: CatchupEntry) =>
		run(async () => {
			const value = revertValue(e);
			if (e.entity === "task") {
				const task = await resolveTaskConflict(workspacePath, e.target, e.path, value);
				if (!task) throw new Error("That task no longer exists, so there is nothing to undo.");
				publishDataChange({ entity: "task", op: "upsert", task });
			} else {
				const card = await resolveCardConflict(workspacePath, e.target, e.path, value);
				if (!card) throw new Error("That card no longer exists, so there is nothing to undo.");
				publishDataChange({ entity: "card", op: "upsert", card });
			}
			await markCatchup(workspacePath, [e.id], "reverted");
			refreshData();
		});

	const revertHunkOf = (e: CatchupEntry, index: number) =>
		run(async () => {
			const all = textHunks(e.before ?? "", e.after ?? "");
			if (!(await revertTextHunk(e.target, all[index]))) throw new Error("That part of the text has been edited since, so it can't be found to undo. Open the file to change it by hand.");
			const next = new Set(undone).add(`${e.id}:${index}`);
			setUndone(next);
			if (all.every((_, k) => next.has(`${e.id}:${k}`))) await markCatchup(workspacePath, [e.id], "reverted");
		});

	const markReviewed = (list: CatchupEntry[]) =>
		run(async () => {
			await markCatchup(workspacePath, list.map((e) => e.id), "seen");
			if (list.length === entries.length) onClose();
		});

	// One change in full: what it was, when, and the undo
	const renderEntry = (e: CatchupEntry) => {
		const hunks = e.kind === "text" && e.before !== null && e.after !== null ? textHunks(e.before, e.after) : null;
		return (
			<li key={e.id} className="space-y-2 px-3 py-2 text-sm">
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="min-w-0">
						<p className="break-words">{describe(e, lookups)}</p>
						<p className="text-xs text-muted-foreground">
							{when(e.at)}
							{e.state === "reverted" && " · undone"}
						</p>
					</div>
					{canRevertField(e) && (
						<Button size="sm" variant="outline" isDisabled={busy} onPress={() => void revertField(e)} className="gap-1.5">
							<Undo2 className="size-3.5" />
							Undo
						</Button>
					)}
				</div>
				{e.kind === "text" && !hunks && <p className="text-xs text-muted-foreground">This change is too large to show here. Open the file's history to see it.</p>}
				{hunks?.map((hunk, index) => (
					<div key={index} className="border">
						<div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-2 py-1">
							<span className="text-xs text-muted-foreground">{hunks.length > 1 ? `Change ${index + 1} of ${hunks.length}` : "Change"}</span>
							{undone.has(`${e.id}:${index}`) ? (
								<span className="text-xs text-muted-foreground">Undone</span>
							) : (
								<Button size="sm" variant="outline" isDisabled={busy || e.state === "reverted"} onPress={() => void revertHunkOf(e, index)} className="h-6 gap-1.5 px-2 text-xs">
									<Undo2 className="size-3" />
									Undo this change
								</Button>
							)}
						</div>
						<DiffView diff={diffLines(hunk.oldLines.join("\n"), hunk.newLines.join("\n"))} />
					</div>
				))}
			</li>
		);
	};

	return (
		<Dialog isOpen onOpenChange={(open) => !open && onClose()} className="sm:max-w-3xl">
			<div className="flex max-h-[75vh] min-h-0 flex-col gap-4">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<History className="size-4" />
						Catch up
					</DialogTitle>
					<DialogDescription>
						What other people changed, by who did it. Merging never loses anything, but it does not ask you either, so this is where you check it. Undoing a change is a new edit that reaches
						everyone like any other.
					</DialogDescription>
				</DialogHeader>

				{error && (
					<p role="alert" className="border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
						{error}
					</p>
				)}

				{entries.length === 0 ? (
					<p className="text-sm text-muted-foreground">Nothing new. You are up to date.</p>
				) : (
					<div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
						{groups.map((group) => {
							const rows = rowsOf(group.entries);
							return (
								<section key={group.who} aria-label={`Changes by ${group.who}`} className="border">
									<div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
										<h3 className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
											{group.who}
											<span className="font-normal text-muted-foreground">
												· {rows.length} {rows.length === 1 ? "change" : "changes"}
											</span>
											{group.vouched ? (
												<span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-500" title="Signed with this member's device key">
													<ShieldCheck className="size-3.5" aria-hidden />
													Verified
												</span>
											) : (
												<span
													className="text-xs font-normal text-muted-foreground"
													title={group.signed ? "Signed by a device that is not on the member list, so the name is the writer's own claim" : "Not signed, so the name is the writer's own claim"}
												>
													{group.signed ? "Name not confirmed" : "Not signed"}
												</span>
											)}
										</h3>
										<Button size="sm" variant="ghost" isDisabled={busy} onPress={() => void markReviewed(group.entries)} className="gap-1.5">
											<Check className="size-3.5" />
											Mark reviewed
										</Button>
									</div>
									<ul className="divide-y divide-border/60">
										{rows.map((row) => {
											const first = row[0];
											// Changes to a file fold into one line; anything else is shown in full as before
											if (first.kind !== "text") return renderEntry(first);
											const key = `${group.who}:${rowKey(first)}`;
											const isOpen = opened.has(key);
											const toggle = () =>
												setOpened((prev) => {
													const next = new Set(prev);
													if (!next.delete(key)) next.add(key);
													return next;
												});
											return (
												<li key={key}>
													<button type="button" onClick={toggle} aria-expanded={isOpen} className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted/30">
														{isOpen ? <ChevronDown className="mt-0.5 size-4 shrink-0" /> : <ChevronRight className="mt-0.5 size-4 shrink-0" />}
														<span className="min-w-0 flex-1">
															<span className="block break-words">
																Edited {first.label}
																{row.length > 1 && <span className="text-muted-foreground"> · {row.length} edits</span>}
															</span>
															<span className="block truncate font-mono text-xs text-emerald-500">+ {previewText(first)}</span>
														</span>
														<span className="shrink-0 text-xs text-muted-foreground">{when(first.at)}</span>
													</button>
													{isOpen && <ul className="divide-y divide-border/60 border-t bg-muted/10">{row.map(renderEntry)}</ul>}
												</li>
											);
										})}
									</ul>
								</section>
							);
						})}
					</div>
				)}

				<div className="flex justify-end gap-2">
					{entries.length > 0 && (
						<Button variant="outline" isDisabled={busy} onPress={() => void markReviewed(entries)}>
							Mark all reviewed
						</Button>
					)}
					<Button onPress={onClose}>Close</Button>
				</div>
			</div>
		</Dialog>
	);
}
