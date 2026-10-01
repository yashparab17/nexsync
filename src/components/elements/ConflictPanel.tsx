// Shown when two people changed the same field of a task or card while apart: both values are kept, and anyone can choose

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Conflict } from "@/types/workspace";

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
	// Turns a stored value into what the person sees (a member id into a name, a list id into its title)
	show: (field: string, value: unknown) => string;
	canChoose: boolean;
	onChoose: (field: string, value: unknown) => void;
}

export default function ConflictPanel({ conflicts, show, canChoose, onChoose }: ConflictPanelProps) {
	if (conflicts.length === 0) return null;
	return (
		<section aria-label="Changes to sort out" className="space-y-3 border border-amber-500/40 bg-amber-500/10 p-3">
			<p className="flex items-center gap-2 text-sm font-semibold text-amber-500">
				<AlertTriangle className="size-4" aria-hidden />
				{conflicts.length === 1 ? "Two people changed this at the same time" : "Two people changed some things at the same time"}
			</p>
			{conflicts.map((c) => (
				<div key={c.field} className="space-y-1.5">
					<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{fieldName(c.field)}</p>
					<ul className="space-y-1.5">
						{c.options.map((o, i) => (
							<li key={i} className="flex items-center justify-between gap-2 border border-border/60 bg-background px-2 py-1.5 text-sm">
								<span className="min-w-0">
									<span className="break-words">{show(c.field, o.value) || "(empty)"}</span>
									<span className="block text-xs text-muted-foreground">
										{o.who ? `${o.who}, ` : ""}
										{new Date(o.ts).toLocaleString()}
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
	);
}
