import type { TaskPriority } from "@/types/workspace";
import { parseNaturalDate } from "@/lib/naturalDate";

export interface QuickTask {
	title: string;
	priority?: TaskPriority;
	tags: string[];
	due?: string;
}

const PRIORITY: Record<string, TaskPriority> = { high: "high", med: "medium", medium: "medium", low: "low" };

// "Fix login #bug !high @fri" is a task titled "Fix login", tagged bug, high priority, due on the coming Friday
export function parseQuickAdd(text: string, from: Date = new Date()): QuickTask {
	let rest = text;
	const out: QuickTask = { title: "", tags: [] };
	rest = rest.replace(/(^|\s)#([\w-]+)/g, (_, sp: string, tag: string) => {
		if (!out.tags.includes(tag.toLowerCase())) out.tags.push(tag.toLowerCase());
		return sp;
	});
	rest = rest.replace(/(^|\s)!(high|medium|med|low)\b/gi, (_, sp: string, p: string) => {
		out.priority = PRIORITY[p.toLowerCase()];
		return sp;
	});
	rest = rest.replace(/(^|\s)@(next \w+|in \d+ \w+|\S+)/gi, (whole, sp: string, when: string) => {
		const date = parseNaturalDate(when, from);
		if (!date) return whole;
		out.due = date;
		return sp;
	});
	out.title = rest.replace(/\s+/g, " ").trim();
	return out;
}
