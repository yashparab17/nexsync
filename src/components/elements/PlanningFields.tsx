// Small building blocks shared by the Tasks and Kanban pages: tags, due-date badge and a card checklist

import { useState } from "react";
import { Calendar, X } from "lucide-react";
import { Plus } from "@/components/animate-icons";

import { addTags, dueState, tagHue, type DueState } from "@/lib/planning";
import { cn } from "@/lib/utils";
import type { ChecklistItem } from "@/types/workspace";

// A tag as a small coloured label; clickable when it filters something
export function TagChip({ tag, active, onClick }: { tag: string; active?: boolean; onClick?: () => void }) {
	const hue = tagHue(tag);
	const style = {
		backgroundColor: `hsl(${hue} 60% 50% / ${active ? 0.35 : 0.15})`,
		borderColor: `hsl(${hue} 60% 50% / 0.4)`,
	};
	const className = "inline-flex items-center rounded-none border px-1.5 py-0.5 text-xs font-semibold text-foreground";
	if (!onClick) {
		return (
			<span className={className} style={style}>
				#{tag}
			</span>
		);
	}
	return (
		<button type="button" onClick={onClick} aria-pressed={active} className={cn(className, "cursor-pointer")} style={style}>
			#{tag}
		</button>
	);
}

// Chips plus a box: Enter or a comma adds what was typed, Backspace on an empty box removes the last tag
export function TagInput({
	id,
	value,
	onChange,
	suggestions = [],
}: {
	id?: string;
	value: string[];
	onChange: (tags: string[]) => void;
	suggestions?: string[];
}) {
	const [draft, setDraft] = useState("");
	const commit = () => {
		if (draft.trim()) onChange(addTags(value, draft));
		setDraft("");
	};
	return (
		<div className="mt-1 flex min-h-10 flex-wrap items-center gap-1.5 rounded-none border border-input bg-background px-2 py-1.5">
			{value.map((tag) => (
				<span key={tag} className="inline-flex items-center gap-1">
					<TagChip tag={tag} />
					<button
						type="button"
						aria-label={`Remove tag ${tag}`}
						onClick={() => onChange(value.filter((t) => t !== tag))}
						className="cursor-pointer text-muted-foreground hover:text-foreground"
					>
						<X className="size-3" />
					</button>
				</span>
			))}
			<input
				id={id}
				value={draft}
				list={id ? `${id}-suggestions` : undefined}
				onChange={(e) => {
					const text = e.target.value;
					if (text.includes(",")) {
						onChange(addTags(value, text));
						setDraft("");
					} else {
						setDraft(text);
					}
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						commit();
					} else if (e.key === "Backspace" && !draft && value.length) {
						onChange(value.slice(0, -1));
					}
				}}
				onBlur={commit}
				placeholder={value.length ? "" : "Add a tag and press Enter"}
				className="min-w-24 flex-1 bg-transparent text-sm outline-none"
			/>
			{id && (
				<datalist id={`${id}-suggestions`}>
					{suggestions.filter((s) => !value.includes(s)).map((s) => (
						<option key={s} value={s} />
					))}
				</datalist>
			)}
		</div>
	);
}

const DUE_STYLE: Record<DueState, string> = {
	overdue: "border-destructive/40 bg-destructive/10 text-destructive",
	today: "border-warning/40 bg-warning/10 text-warning",
	soon: "border-warning/30 bg-warning/5 text-warning",
	later: "border-border text-muted-foreground",
};
const DUE_LABEL: Record<DueState, string> = { overdue: "Overdue", today: "Due today", soon: "Due soon", later: "Due" };

// "Due 4 Mar", coloured by urgency; nothing at all when there is no date
export function DueBadge({ due, done }: { due?: string | null; done: boolean }) {
	if (!due) return null;
	const state = dueState(due, done) ?? "later";
	const day = new Date(`${due.slice(0, 10)}T00:00:00`);
	return (
		<span className={cn("inline-flex items-center gap-1 rounded-none border px-1.5 py-0.5 text-xs font-medium", DUE_STYLE[state])}>
			<Calendar className="size-3" />
			{DUE_LABEL[state]} {day.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
		</span>
	);
}

// Add, tick and remove checklist lines
export function ChecklistEditor({ value, onChange }: { value: ChecklistItem[]; onChange: (items: ChecklistItem[]) => void }) {
	const [draft, setDraft] = useState("");
	const add = () => {
		const text = draft.trim();
		if (text) onChange([...value, { id: crypto.randomUUID(), text, done: false }]);
		setDraft("");
	};
	return (
		<div className="mt-1 space-y-1.5">
			{value.map((item) => (
				<div key={item.id} className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={item.done}
						aria-label={`Done: ${item.text}`}
						onChange={() => onChange(value.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))}
					/>
					<span className={cn("min-w-0 flex-1 truncate", item.done && "text-muted-foreground line-through")}>{item.text}</span>
					<button
						type="button"
						aria-label={`Remove ${item.text}`}
						onClick={() => onChange(value.filter((i) => i.id !== item.id))}
						className="cursor-pointer text-muted-foreground hover:text-destructive"
					>
						<X className="size-3.5" />
					</button>
				</div>
			))}
			<div className="flex items-center gap-2">
				<input
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							add();
						}
					}}
					aria-label="New checklist item"
					placeholder="Add an item"
					className="h-8 flex-1 rounded-none border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
				/>
				<button
					type="button"
					aria-label="Add checklist item"
					onClick={add}
					className="flex size-8 cursor-pointer items-center justify-center border border-input hover:bg-muted"
				>
					<Plus className="size-4" />
				</button>
			</div>
		</div>
	);
}
