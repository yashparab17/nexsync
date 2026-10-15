// A small speech-bubble count beside a task or card in a list: its comments, and the open threads of its discussion.

import { MessageSquare } from "@/components/animate-icons";

import { openThreadCounts, itemChannel } from "@/lib/chat/entries";
import { useChat } from "@/store/chat/ChatContext";
import { useMemo } from "react";

// One lookup for the whole list: call `useThreadCounts` once and pass `n` to each row
export function useThreadCounts(): Map<string, number> {
	const { entries } = useChat();
	return useMemo(() => openThreadCounts(entries), [entries]);
}

export default function CommentCount({ entity, id, legacy = 0, counts }: { entity: "task" | "card"; id: string; legacy?: number; counts: Map<string, number> }) {
	const n = legacy + (counts.get(itemChannel(entity, id)) ?? 0);
	if (n === 0) return null;
	return (
		<span title={`${n} comment${n === 1 ? "" : "s"}`} className="inline-flex items-center gap-1 font-mono text-[13px] text-muted-foreground">
			<MessageSquare className="size-3.5" aria-hidden />
			<span aria-label={`${n} comments`}>{n}</span>
		</span>
	);
}
