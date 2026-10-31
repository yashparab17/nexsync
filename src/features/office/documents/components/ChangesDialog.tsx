import { Check, ListTodo, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import type { Change } from "@/features/office/documents/lib/documentReview";
import { colorOf } from "@/lib/collabColor";

const when = (iso: string) => {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

// Every tracked change in order, with who made it and when; each can be gone to, accepted or rejected, and the list can be narrowed to one person.
// `changes` is the live list, so a change that is accepted leaves it.
export default function ChangesDialog({ changes, readOnly, onGo, onResolve, onClose }: { changes: Change[]; readOnly: boolean; onGo: (c: Change) => void; onResolve: (c: Change, accept: boolean) => void; onClose: () => void }) {
	const [who, setWho] = useState("");
	const people = useMemo(() => [...new Set(changes.map((c) => c.author))].sort(), [changes]);
	const shown = who ? changes.filter((c) => c.author === who) : changes;
	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-w-xl">
			<div className="space-y-3 text-sm">
				<DialogHeading icon={<ListTodo className="size-6" />} title="Changes" />
				{changes.length === 0 ? (
					<p role="status">No tracked changes.</p>
				) : (
					<>
						<div className="flex items-center gap-2">
							<label htmlFor="changes-who" className="text-muted-foreground">
								Show
							</label>
							<select id="changes-who" value={who} onChange={(e) => setWho(e.target.value)} className="h-8 border bg-background px-2">
								<option value="">Everyone ({changes.length})</option>
								{people.map((p) => (
									<option key={p} value={p}>
										{p || "Someone"} ({changes.filter((c) => c.author === p).length})
									</option>
								))}
							</select>
						</div>
						<ul className="max-h-80 space-y-2 overflow-y-auto">
							{shown.map((c) => (
								<li key={`${c.kind}${c.from}`} className="flex items-start gap-3 border p-2">
									<span aria-hidden className="mt-1 size-3 shrink-0" style={{ background: colorOf(c.author || "Someone") }} />
									<div className="min-w-0 flex-1">
										<p className="text-[13px] text-muted-foreground">
											{c.author || "Someone"} {c.kind === "insertion" ? "added" : "deleted"}
											{when(c.date) && ` · ${when(c.date)}`}
										</p>
										<p className={c.kind === "deletion" ? "line-through" : "underline decoration-double"}>{c.text.length > 160 ? `${c.text.slice(0, 160)}…` : c.text}</p>
									</div>
									<span className="flex shrink-0 gap-1">
										<Button size="sm" variant="outline" onPress={() => onGo(c)}>
											Go There
										</Button>
										{!readOnly && (
											<>
												<Button size="icon-xs" variant="ghost" aria-label="Accept" onPress={() => onResolve(c, true)}>
													<Check className="size-4" />
												</Button>
												<Button size="icon-xs" variant="ghost" aria-label="Reject" onPress={() => onResolve(c, false)}>
													<X className="size-4" />
												</Button>
											</>
										)}
									</span>
								</li>
							))}
						</ul>
					</>
				)}
				<DialogFooter>
					<Button onPress={onClose}>Close</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
