// A Discuss button that opens a short discussion in place: for a change in the catch-up review, a branch, a draft.
// The thread is a channel of the signed log named for the thing, like the one under a task or card.

import { useState } from "react";

import { AnimateIcon, MessageSquareText } from "@/components/animate-icons";
import FieldDiscussion from "@/components/elements/FieldDiscussion";
import { openThreadCounts } from "@/features/chat/lib/entries";
import { useChat } from "@/store/chat/ChatContext";

export default function DiscussToggle({ channel, canComment }: { channel: string; canComment: boolean }) {
	const chat = useChat();
	const [open, setOpen] = useState(false);
	const n = openThreadCounts(chat.entries).get(channel) ?? 0;
	return (
		<div className="space-y-1">
			<AnimateIcon animateOnHover asChild>
				<button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex h-8 cursor-pointer items-center gap-1 font-mono text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
				<MessageSquareText className="size-3.5" aria-hidden />
				Discuss{n > 0 ? ` (${n})` : ""}
			</button>
			</AnimateIcon>
			{open && <FieldDiscussion channel={channel} field="" canComment={canComment} placeholder="Say something about this" label="Discuss this" />}
		</div>
	);
}
