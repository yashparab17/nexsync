// The replies to one message, in a panel beside the channel, with their own box to answer in.

import { useState } from "react";
import { X } from "lucide-react";

import Composer from "@/features/chat/components/Composer";
import Toolbar from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import Attachment from "@/features/chat/components/Attachment";
import RichText from "@/features/chat/components/RichText";
import Avatar from "@/components/elements/Avatar";
import type { Message } from "@/features/chat/lib/entries";
import type { Person } from "@/features/chat/lib/mentions";

interface ThreadPanelProps {
	root: Message;
	replies: Message[];
	channelName: string;
	people: Person[];
	me: string;
	canPost: boolean;
	cooldownUntil: number;
	refTitle: (entity: "task" | "card", id: string) => string | undefined;
	onOpenRef: (entity: "task" | "card", id: string) => void;
	onOpenNote: (name: string) => void;
	onSend: (text: string) => void;
	onClose: () => void;
}

const when = (ts: number) => new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function ThreadPanel({ root, replies, channelName, people, me, canPost, cooldownUntil, refTitle, onOpenRef, onOpenNote, onSend, onClose }: ThreadPanelProps) {
	const [draft, setDraft] = useState("");
	const show = (m: Message) => (
		<li key={m.id} className="flex gap-3 px-4 py-2">
			<Avatar name={m.name} className="mt-1 size-8 text-xs" />
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-2">
					<span className="truncate text-sm font-semibold">{m.name}</span>
					<time dateTime={new Date(m.ts).toISOString()} className="font-mono text-[13px] text-muted-foreground">
						{when(m.ts)}
					</time>
				</div>
				{m.deleted ? <p className="text-sm text-muted-foreground italic">Message deleted</p> : <RichText text={m.text} people={people} me={me} onOpenNote={onOpenNote} refTitle={refTitle} onOpenRef={onOpenRef} renderFile={(path) => <Attachment path={path} />} />}
			</div>
		</li>
	);
	return (
		<aside aria-label="Thread" className="flex w-72 shrink-0 flex-col @4xl:w-80 border-l bg-panel">
			<Toolbar variant="header" className="gap-2">
				<h2 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">Thread in #{channelName}</h2>
				<Button variant="ghost" size="icon-sm" aria-label="Close thread" onPress={onClose}>
					<X className="size-4" />
				</Button>
			</Toolbar>
			<ul className="min-h-0 flex-1 overflow-y-auto py-2">
				{show(root)}
				{replies.length > 0 && (
					<li role="separator" className="px-4 py-1 font-mono text-[13px] text-muted-foreground">
						{replies.length} {replies.length === 1 ? "reply" : "replies"}
					</li>
				)}
				{replies.map(show)}
			</ul>
			<Composer
				channelName="this thread"
				canPost={canPost}
				people={people}
				reply={null}
				onCancelReply={() => {}}
				onSend={(text) => {
					setDraft("");
					onSend(text);
				}}
				draft={draft}
				onDraft={setDraft}
				focusKey={root.id}
				cooldownUntil={cooldownUntil}
			/>
		</aside>
	);
}
