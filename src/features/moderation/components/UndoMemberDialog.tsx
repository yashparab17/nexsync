// Undo everything one member changed, as new writes. A change is only undone for you when nobody built on it: if others wrote
// in the same record since, undoing could overwrite their work, so those are listed for a person to decide one by one. Text in
// notes and code is never undone here; it opens in the catch-up review, where each change is undone by hand.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Undo2 } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
import { describe, revertValue, type Lookups } from "@/lib/catchup";
import { getKanban, getMemberChanges, markCatchup, resolveCardConflict, resolveTaskConflict, type MemberChange } from "@/lib/tauri";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { KanbanColumn, Member } from "@/types/workspace";

const CatchUpDialog = lazy(() => import("@/components/dialogs/workspace/CatchUpDialog"));

export default function UndoMemberDialog({ member, onClose }: { member: Member; onClose: () => void }) {
	const { workspace, metadata } = useWorkspace();
	const { publishDataChange, refreshData } = useP2P();
	const path = workspace?.path ?? "";
	const members = useMemo(() => metadata?.members.members ?? [], [metadata]);
	const [changes, setChanges] = useState<MemberChange[] | null>(null);
	const [columns, setColumns] = useState<KanbanColumn[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState(0);
	const [reviewText, setReviewText] = useState(false);

	const load = useCallback(async () => {
		try {
			setChanges(await getMemberChanges(path, member.deviceId ?? "", member.name));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [path, member]);
	useEffect(() => {
		void load();
		getKanban(path).then(setColumns).catch(() => {});
	}, [load, path]);

	const lookups: Lookups = useMemo(
		() => ({ member: (id) => members.find((m) => m.id === id)?.name ?? "a removed member", column: (id) => (id === "recovered" ? "Recovered" : (columns.find((c) => c.id === id)?.title ?? "another list")) }),
		[members, columns],
	);

	const fields = (changes ?? []).filter((c) => c.entry.kind === "field" && (c.entry.entity === "task" || c.entry.entity === "card"));
	const safe = fields.filter((c) => !c.replaced && !c.builtOn);
	const decide = fields.filter((c) => !c.replaced && c.builtOn);
	const replaced = fields.filter((c) => c.replaced);
	const text = (changes ?? []).filter((c) => c.entry.kind === "text");

	const undo = async (list: MemberChange[]) => {
		setBusy(true);
		setError(null);
		let n = 0;
		try {
			for (const c of list) {
				const e = c.entry;
				const value = revertValue(e);
				if (e.entity === "task") {
					const task = await resolveTaskConflict(path, e.target, e.path, value);
					if (task) publishDataChange({ entity: "task", op: "upsert", task });
				} else {
					const card = await resolveCardConflict(path, e.target, e.path, value);
					if (card) publishDataChange({ entity: "card", op: "upsert", card });
				}
				await markCatchup(path, [e.id], "reverted");
				n++;
			}
			refreshData();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setDone((d) => d + n);
			setBusy(false);
			await load();
		}
	};

	return (
		<Dialog isOpen onOpenChange={(open) => !open && onClose()} className="sm:max-w-2xl">
			<div className="flex max-h-[75vh] min-h-0 flex-col gap-4">
				<DialogHeading icon={<Undo2 className="size-6" />} title={`Undo Changes by ${member.name}`} />
				{error && (
					<p role="alert" className="bg-destructive/10 p-2 text-sm text-destructive">
						{error}
					</p>
				)}
				{changes === null ? (
					<p className="text-sm text-muted-foreground">Looking through what this device recorded…</p>
				) : (
					<div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
						<p className="text-[13px] text-muted-foreground">
							This lists what this device saw {member.name} change; changes that were never merged here are not in it. Every undo is a new edit that reaches everyone like any other.
							{done > 0 && ` ${done} undone just now.`}
						</p>
						<section aria-label="Safe to undo" className="space-y-2 rounded-md bg-muted/40 p-3">
							<div className="flex items-center justify-between gap-3">
								<h3 className="text-sm font-semibold">Safe to Undo / {safe.length}</h3>
								<Button size="sm" isDisabled={busy || safe.length === 0} onPress={() => void undo(safe)}>
									Undo {safe.length} {safe.length === 1 ? "Change" : "Changes"}
								</Button>
							</div>
							<p className="text-[13px] text-muted-foreground">Nobody has written in these records since. Undoing puts the old value back.</p>
							<ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
								{safe.map((c) => (
									<li key={c.entry.id}>{describe(c.entry, lookups)}</li>
								))}
							</ul>
						</section>
						<section aria-label="Needs a decision" className="space-y-2 rounded-md bg-warning/10 p-3">
							<h3 className="text-sm font-semibold">Needs Your Decision / {decide.length}</h3>
							<p className="text-[13px] text-muted-foreground">Others wrote in these records after {member.name}, probably having seen it. Undoing may overwrite their work, so each one is yours to choose.</p>
							<ul className="space-y-2 text-sm">
								{decide.map((c) => (
									<li key={c.entry.id} className="flex items-start justify-between gap-3">
										<span className="min-w-0 break-words">{describe(c.entry, lookups)}</span>
										<Button size="sm" variant="outline" isDisabled={busy} onPress={() => void undo([c])}>
											Undo
										</Button>
									</li>
								))}
							</ul>
						</section>
						{(replaced.length > 0 || text.length > 0) && (
							<section aria-label="Left alone" className="space-y-2 rounded-md bg-muted/40 p-3 text-[13px] text-muted-foreground">
								{replaced.length > 0 && <p>{replaced.length} {replaced.length === 1 ? "change was" : "changes were"} already replaced by someone else&apos;s value, so there is nothing of theirs to undo.</p>}
								{text.length > 0 && (
									<p className="flex flex-wrap items-center gap-3">
										<span>{text.length} text {text.length === 1 ? "change" : "changes"} in notes and code are never undone for you.</span>
										<Button size="sm" variant="outline" onPress={() => setReviewText(true)}>
											Review Text Changes
										</Button>
									</p>
								)}
							</section>
						)}
					</div>
				)}
				<div className="flex justify-end">
					<Button variant="ghost" onPress={onClose}>
						Close
					</Button>
				</div>
			</div>
			{reviewText && (
				<Suspense fallback={null}>
					<CatchUpDialog workspacePath={path} entries={text.map((c) => c.entry)} lookups={lookups} members={members} onChanged={load} onClose={() => setReviewText(false)} />
				</Suspense>
			)}
		</Dialog>
	);
}
