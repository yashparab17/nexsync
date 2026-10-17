// Shown when a task or card needs attention after merging: two people changed the same field while apart (both values
// are kept and anyone can choose), or the merged record breaks a rule the workspace turned on (nothing to choose between;
// someone has to fix the record)

import { useState } from "react";

import { AlertTriangle, MessageSquareText, ShieldAlert } from "@/components/animate-icons";
import FieldDiscussion from "@/components/elements/FieldDiscussion";
import { buildThreads, itemChannel } from "@/features/chat/lib/entries";
import { whyConflict } from "@/lib/conflictWhy";
import { useChat } from "@/store/chat/ChatContext";

import { Button } from "@/components/ui/button";
import type { Conflict, Violation } from "@/types/workspace";

const FIELD_NAMES: Record<string, string> = {
	title: "Title",
	description: "Description",
	status: "Status",
	priority: "Priority",
	due_date: "Due date",
	assignee_id: "Assigned to",
	column_id: "List",
};

export const fieldName = (field: string) => FIELD_NAMES[field] ?? field;

interface ConflictPanelProps {
	conflicts: Conflict[];
	violations?: Violation[];
	// Turns a stored value into what the person sees (a member id into a name, a list id into its title)
	show: (field: string, value: unknown) => string;
	canChoose: boolean;
	onChoose: (field: string, value: unknown) => void;
	// The task or card these belong to: when given, each conflict has a short discussion, and the choice is written into it
	record?: { entity: "task" | "card"; id: string };
}

export default function ConflictPanel({ conflicts, violations = [], show, canChoose, onChoose, record }: ConflictPanelProps) {
	const chat = useChat();
	const [discussing, setDiscussing] = useState<string | null>(null);
	const channel = record ? itemChannel(record.entity, record.id) : null;

	// Choosing a value says so in the discussion of that field, so the others see why it changed
	const choose = (field: string, value: unknown) => {
		onChoose(field, value);
		if (!channel || !chat.canPost) return;
		const thread = buildThreads(chat.entries, channel).find((t) => t.field === field && !t.resolved);
		const text = `Kept “${show(field, value) || "(empty)"}”`;
		void chat.post({ kind: "comment", channel, parent: thread?.id ?? "", body: JSON.stringify({ text, ...(thread ? {} : { field }) }) }).catch(() => {});
	};

	if (conflicts.length === 0 && violations.length === 0) return null;
	return (
		<>
			{violations.length > 0 && (
				<section aria-label="Rules this breaks" className="space-y-2 border border-warning/40 bg-warning/10 p-3">
					<p className="flex items-center gap-2 text-sm font-semibold text-warning">
						<ShieldAlert className="size-4" aria-hidden />
						This breaks a rule of the workspace
					</p>
					<ul className="space-y-1 text-sm">
						{violations.map((v) => (
							<li key={v.rule}>{v.message}</li>
						))}
					</ul>
					<p className="text-xs text-muted-foreground">Edits made at the same time were each fine on their own. Change one of the fields to fix it.</p>
				</section>
			)}
			{conflicts.length > 0 && (
				<section aria-label="Changes to sort out" className="space-y-3 border border-warning/40 bg-warning/10 p-3">
					<p className="flex items-center gap-2 text-sm font-semibold text-warning">
						<AlertTriangle className="size-4" aria-hidden />
						{conflicts.length === 1 ? "Two people changed this at the same time" : "Two people changed some things at the same time"}
					</p>
					{conflicts.map((c) => (
						<div key={c.field} className="space-y-2">
							<div className="flex items-center justify-between gap-2">
								<p className="text-xs font-semibold text-muted-foreground">{fieldName(c.field)}</p>
								{channel && (
									<button type="button" aria-expanded={discussing === c.field} onClick={() => setDiscussing(discussing === c.field ? null : c.field)} className="flex cursor-pointer items-center gap-1 font-mono text-[13px] text-muted-foreground hover:text-foreground">
										<MessageSquareText className="size-3.5" aria-hidden />
										Discuss
									</button>
								)}
							</div>
							<p className="text-xs text-muted-foreground">{whyConflict(c.options, (v) => show(c.field, v))}</p>
							<ul className="space-y-2">
								{c.options.map((o, i) => (
									<li key={i} className="flex items-center justify-between gap-2 border border-border/60 bg-background px-2 py-2 text-sm">
										<span className="min-w-0">
											<span className="break-words">{show(c.field, o.value) || "(empty)"}</span>
											<span className="block text-xs text-muted-foreground">
												{o.who ? `${o.who}, ` : ""}
												{new Date(o.ts).toLocaleString()}
												{o.by ? " · signed" : ""}
												{i === 0 ? " · shown now" : ""}
											</span>
										</span>
										{canChoose && (
											<Button type="button" size="sm" variant={i === 0 ? "default" : "outline"} onPress={() => choose(c.field, o.value)}>
												Keep This
											</Button>
										)}
									</li>
								))}
							</ul>
							{channel && discussing === c.field && <FieldDiscussion channel={channel} field={c.field} canComment={chat.canPost} />}
						</div>
					))}
				</section>
			)}
		</>
	);
}
