// Month view of tasks by due date; clicking a task opens it

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { dueState, localDay, monthGrid } from "@/lib/planning";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/workspace";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function TaskCalendar({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
	const today = localDay();
	const [cursor, setCursor] = useState(() => ({ year: +today.slice(0, 4), month: +today.slice(5, 7) - 1 }));
	const weeks = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
	const byDay = useMemo(() => {
		const days = new Map<string, Task[]>();
		for (const task of tasks) {
			if (!task.due_date) continue;
			const day = task.due_date.slice(0, 10);
			days.set(day, [...(days.get(day) ?? []), task]);
		}
		return days;
	}, [tasks]);
	const undated = tasks.filter((t) => !t.due_date).length;

	const shift = (by: number) =>
		setCursor(({ year, month }) => {
			const d = new Date(Date.UTC(year, month + by, 1));
			return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
		});
	const title = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString(undefined, {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-semibold" aria-live="polite">
					{title}
				</h2>
				<div className="flex items-center gap-1">
					<Button variant="outline" size="icon-xs" aria-label="Previous month" onPress={() => shift(-1)}>
						<ChevronLeft className="size-4" />
					</Button>
					<Button
						variant="outline"
						size="xs"
						onPress={() => setCursor({ year: +today.slice(0, 4), month: +today.slice(5, 7) - 1 })}
					>
						Today
					</Button>
					<Button variant="outline" size="icon-xs" aria-label="Next month" onPress={() => shift(1)}>
						<ChevronRight className="size-4" />
					</Button>
				</div>
			</div>

			<div className="grid grid-cols-7 gap-px border bg-border text-xs">
				{WEEKDAYS.map((d) => (
					<div key={d} className="bg-muted/40 px-2 py-1 font-semibold text-muted-foreground">
						{d}
					</div>
				))}
				{weeks.flat().map((day) => {
					const inMonth = +day.slice(5, 7) - 1 === cursor.month;
					return (
						<div key={day} className={cn("min-h-24 bg-card p-1.5", !inMonth && "bg-muted/20 text-muted-foreground/60")}>
							<div className={cn("mb-1 text-xs", day === today && "font-bold text-primary")}>{+day.slice(8, 10)}</div>
							<div className="space-y-1">
								{(byDay.get(day) ?? []).map((task) => {
									const state = dueState(task.due_date, task.status === "done");
									return (
										<button
											key={task.id}
											type="button"
											onClick={() => onOpen(task)}
											className={cn(
												"block w-full cursor-pointer truncate border px-1 py-0.5 text-left text-xs hover:bg-muted",
												task.status === "done" && "text-muted-foreground line-through",
												state === "overdue" && "border-destructive/40 text-destructive",
												(state === "today" || state === "soon") && "border-warning/40",
											)}
										>
											{task.title}
										</button>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>
			{undated > 0 && <p className="text-xs text-muted-foreground">{undated} task{undated === 1 ? "" : "s"} without a due date are not shown.</p>}
		</div>
	);
}
