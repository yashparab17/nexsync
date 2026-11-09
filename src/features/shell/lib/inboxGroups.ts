import type { InboxItem } from "@/lib/tauri";

export type InboxGroupKey = "mentions" | "assigned" | "other";

export interface InboxGroup {
	key: InboxGroupKey;
	label: string;
	items: InboxItem[];
}

const MENTIONS = new Set(["mention", "reply", "dm"]);

export function groupOf(item: InboxItem): InboxGroupKey {
	if (MENTIONS.has(item.kind)) return "mentions";
	if (item.kind === "assigned" || item.kind === "assignment") return "assigned";
	return "other";
}

// The inbox in the order it is read: mentions, then assigned, then the rest; each newest first. Empty groups are left out.
export function groupInbox(items: InboxItem[]): InboxGroup[] {
	const labels: Record<InboxGroupKey, string> = { mentions: "Mentions", assigned: "Assigned", other: "Other" };
	return (["mentions", "assigned", "other"] as const)
		.map((key) => ({ key, label: labels[key], items: items.filter((i) => groupOf(i) === key).sort((a, b) => b.at - a.at) }))
		.filter((g) => g.items.length > 0);
}
