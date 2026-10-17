// A short discussion under one conflicted field of a task or card: people say which value is right before someone chooses,
// and the choice itself is written into the thread. It is a thread of the signed log on the record's channel, tagged with
// the field (see src/lib/chat).

import { useMemo, useState } from "react";
import { AnimateIcon, Bell, BellRing, CornerUpLeft } from "@/components/animate-icons";
import { Button } from "@/components/ui/button";
import ReactionBar from "@/features/chat/components/ReactionBar";
import RichText from "@/features/chat/components/RichText";
import Avatar from "@/components/elements/Avatar";
import { buildThreads, type Point } from "@/features/chat/lib/entries";
import { encodeMentions } from "@/features/chat/lib/mentions";
import { useChat } from "@/store/chat/ChatContext";

interface FieldDiscussionProps {
	channel: string; // "task:<id>" or "card:<id>"
	field: string; // Empty for a discussion of the whole item, a file or an attachment
	canComment: boolean;
	placeholder?: string;
	label?: string;
	threadId?: string; // Show and answer this thread, not the item's general one
	point?: Point; // Start a new thread pinned to this place in a picture or on a page of a PDF
	onPosted?: () => void;
}

export default function FieldDiscussion({ channel, field, canComment, placeholder = "Which one is right? Say so here", label = "Discuss this change", threadId, point, onPosted }: FieldDiscussionProps) {
	const chat = useChat();
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const thread = useMemo(() => buildThreads(chat.entries, channel).find((t) => (threadId ? t.id === threadId : point ? false : t.field === field && !t.anchor && !t.point && !t.resolved)), [chat.entries, channel, field, threadId, point]);

	const send = async () => {
		const value = text.trim();
		if (!value || busy) return;
		setBusy(true);
		try {
			const body = JSON.stringify({ text: encodeMentions(value, chat.people), ...(thread ? {} : point ? { point } : field ? { field } : {}) });
			await chat.post({ kind: "comment", channel, parent: thread?.id ?? "", body });
			setText("");
			onPosted?.();
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-2 pt-1" aria-label="Discussion">
			{thread && (
				<ul className="space-y-2">
					{thread.comments
						.filter((c) => !c.deleted)
						.map((c) => (
							<li key={c.id} className="flex gap-2">
								<Avatar name={c.name} className="mt-1 size-5 text-xs" />
								<div className="min-w-0 flex-1">
									<span className="text-[13px] font-semibold">{c.name}</span> <span className="font-mono text-[13px] text-muted-foreground">{new Date(c.ts).toLocaleString()}</span>
									<RichText text={c.text} people={chat.people} me={chat.me} />
									{!c.deleted && <ReactionBar reactions={c.reactions} me={chat.me} canReact={canComment && chat.canPost} onReact={(emoji) => chat.toggleReaction(channel, c.id, emoji, c.reactions)} />}
								</div>
							</li>
						))}
				</ul>
			)}
			{!field && !threadId && !point && (
				<AnimateIcon animateOnHover asChild>
					<button type="button" aria-pressed={chat.follows.has(channel)} onClick={() => chat.follow(channel, !chat.follows.has(channel))} className="flex h-8 cursor-pointer items-center gap-1 font-mono text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
						{chat.follows.has(channel) ? <BellRing className="size-3.5" /> : <Bell className="size-3.5" />}
						{chat.follows.has(channel) ? "Following: you are told about new comments" : "Follow to be told about new comments"}
					</button>
				</AnimateIcon>
			)}
			{canComment && chat.canPost && (
				<div className="flex items-end gap-2">
					<textarea
						value={text}
						rows={1}
						maxLength={4000}
						aria-label={label}
						placeholder={placeholder}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								void send();
							}
						}}
						className="min-h-8 flex-1 resize-none rounded-md bg-input px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
					/>
					<Button variant="ghost" size="icon-sm" aria-label="Send" isDisabled={!text.trim() || busy} onPress={() => void send()} className="text-primary">
						<CornerUpLeft className="size-4" />
					</Button>
				</div>
			)}
		</div>
	);
}
