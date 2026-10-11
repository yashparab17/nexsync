// Shown when a task or card needs attention after merging: two people changed the same field while apart (both values
// are kept and anyone can choose), or the merged record breaks a rule the workspace turned on (nothing to choose between;
// someone has to fix the record)

import { AlertTriangle, ShieldAlert } from "lucide-react";

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
}

export default function ConflictPanel({ conflicts, violations = [], show, canChoose, onChoose }: ConflictPanelProps) {
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
						<div key={c.field} className="space-y-1.5">
							<p className="text-xs font-semibold text-muted-foreground">{fieldName(c.field)}</p>
							<ul className="space-y-1.5">
								{c.options.map((o, i) => (
									<li key={i} className="flex items-center justify-between gap-2 border border-border/60 bg-background px-2 py-1.5 text-sm">
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
											<Button type="button" size="sm" variant={i === 0 ? "default" : "outline"} onPress={() => onChoose(c.field, o.value)}>
												Keep this
											</Button>
										)}
									</li>
								))}
							</ul>
						</div>
					))}
				</section>
			)}
		</>
	);
}
