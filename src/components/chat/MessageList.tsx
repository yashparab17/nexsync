// The messages of a channel, Discord-style: runs of one person's messages are grouped under a single avatar and name, days are
// separated, a reply shows the line it answers, and hovering a message shows what can be done with it.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AnimateIcon, CornerUpLeft, ListTodo, MessagesSquare, Pencil, SmilePlus, Trash2 } from "@/components/animate-icons";

import Attachment from "@/components/chat/Attachment";
import RichText from "@/components/chat/RichText";
import Avatar from "@/components/elements/Avatar";
import { plainPreview } from "@/lib/chat/preview";
import type { Message } from "@/lib/chat/entries";
import { decodeMentions, type Person } from "@/lib/chat/mentions";
import { cn } from "@/lib/utils";

export const EMOJI = ["👍", "❤️", "😂", "🎉", "👀", "✅", "🙏", "😮"];

const GROUP_MS = 5 * 60 * 1000;

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const clock = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const dayLabel = (ts: number) => {
	const now = Date.now();
	if (sameDay(ts, now)) return "Today";
	if (sameDay(ts, now - 24 * 60 * 60 * 1000)) return "Yesterday";
	return new Date(ts).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
};

interface MessageListProps {
	messages: Message[];
	people: Person[];
	me: string;
	// Authors who were removed from the workspace, by device key: what they wrote stays and is marked
	removed: Set<string>;
	canPost: boolean;
	isAdmin: boolean; // May delete anyone's message
	firstUnreadId: string | null;
	onReply: (m: Message) => void;
	onSaveEdit: (m: Message, text: string) => void;
	onDelete: (m: Message) => void;
	onReact: (m: Message, emoji: string) => void;
	onOpenNote: (name: string) => void;
	// Messages that reached this device after newer ones
	late: Set<string>;
	refTitle: (entity: "task" | "card", id: string) => string | undefined;
	onOpenRef: (entity: "task" | "card", id: string) => void;
	onMakeTask?: (m: Message) => void; // Absent when this role cannot make tasks
	// How many messages answer each message, directly or through other replies, and the way to open them
	replyCounts: Map<string, number>;
	onOpenThread: (m: Message) => void;
}

export default function MessageList({ messages, people, me, removed, canPost, isAdmin, firstUnreadId, onReply, onSaveEdit, onDelete, onReact, onOpenNote, late, refTitle, onOpenRef, onMakeTask, replyCounts, onOpenThread }: MessageListProps) {
	const scroller = useRef<HTMLDivElement>(null);
	const stuck = useRef(true);
	const [editing, setEditing] = useState<string | null>(null);
	const [picker, setPicker] = useState<string | null>(null);
	const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

	// Stay at the bottom while new messages come in, unless the reader scrolled up to read
	useLayoutEffect(() => {
		const el = scroller.current;
		if (el && stuck.current) el.scrollTop = el.scrollHeight;
	}, [messages.length]);
	useEffect(() => {
		const last = messages[messages.length - 1];
		if (last?.author === me) stuck.current = true;
	}, [messages, me]);

	const jumpTo = (id: string) => scroller.current?.querySelector<HTMLElement>(`[data-message="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });

	return (
		<div
			ref={scroller}
			role="log"
			aria-label="Messages"
			aria-live="polite"
			onScroll={(e) => {
				const el = e.currentTarget;
				stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
			}}
			className="min-h-0 flex-1 overflow-y-auto py-4"
		>
			{messages.map((m, i) => {
				const prev = messages[i - 1];
				const newDay = !prev || !sameDay(prev.ts, m.ts);
				const compact = !!prev && !newDay && prev.author === m.author && !m.replyTo && m.ts - prev.ts < GROUP_MS && !prev.deleted;
				const parent = m.replyTo ? byId.get(m.replyTo) : undefined;
				const mine = m.author === me;
				return (
					<div key={m.id}>
						{newDay && (
							<div className="my-3 flex items-center gap-3 px-4" role="separator" aria-label={dayLabel(m.ts)}>
								<span className="h-px flex-1 bg-foreground/15" />
								<span className="font-mono text-[13px] text-muted-foreground">{dayLabel(m.ts)}</span>
								<span className="h-px flex-1 bg-foreground/15" />
							</div>
						)}
						{m.id === firstUnreadId && (
							<div className="my-2 flex items-center gap-3 px-4" role="separator" aria-label="New messages">
								<span className="h-px flex-1 bg-destructive/60" />
								<span className="font-mono text-[13px] text-destructive">New</span>
							</div>
						)}
						<div
							data-message={m.id}
							className={cn("group relative flex gap-4 px-4 py-1 hover:bg-muted/40 focus-within:bg-muted/40", !compact && "mt-3 first:mt-0")}
						>
							{compact ? (
								<span className="w-10 shrink-0 pt-1 text-right font-mono text-[13px] text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden>
									{clock(m.ts)}
								</span>
							) : (
								<Avatar name={m.name} className="mt-1 size-10 text-sm" />
							)}
							<div className="min-w-0 flex-1">
								{m.replyTo && (
									<AnimateIcon animateOnHover asChild>
									<button
										type="button"
										onClick={() => jumpTo(m.replyTo)}
										className="mb-1 flex max-w-full cursor-pointer items-center gap-2 text-[13px] text-muted-foreground outline-none hover:text-foreground"
									>
										<CornerUpLeft className="size-3.5 shrink-0" />
										{parent ? (
											<span className="truncate">
												<span className="font-semibold">{parent.name}</span> {parent.deleted ? "Message deleted" : plainPreview(parent.text, people)}
											</span>
										) : (
											<span>An earlier message</span>
										)}
									</button>
									</AnimateIcon>
								)}
								{!compact && (
									<div className="flex items-baseline gap-2">
										<span className="text-sm font-semibold">{m.name}</span>
										{removed.has(m.author) && <span className="rounded-sm bg-destructive/15 px-1 font-mono text-[13px] text-destructive">Removed</span>}
										<time dateTime={new Date(m.ts).toISOString()} className="font-mono text-[13px] text-muted-foreground">
											{clock(m.ts)}
										</time>
										{late.has(m.id) && (
											<span title="This message reached you after newer ones, so it is shown where it was written" className="rounded-sm bg-muted px-1 font-mono text-[13px] text-muted-foreground">
												arrived late
											</span>
										)}
									</div>
								)}
								{m.deleted ? (
									<p className="text-sm text-muted-foreground italic">Message deleted</p>
								) : editing === m.id ? (
									<InlineEdit
										initial={decodeMentions(m.text, people)}
										onCancel={() => setEditing(null)}
										onSave={(text) => {
											setEditing(null);
											if (text.trim() && text.trim() !== decodeMentions(m.text, people)) onSaveEdit(m, text.trim());
										}}
									/>
								) : (
									<div>
										<RichText text={m.text} people={people} me={me} onOpenNote={onOpenNote} refTitle={refTitle} onOpenRef={onOpenRef} renderFile={(path) => <Attachment path={path} />} />
										{m.editedAt && <span className="text-[13px] text-muted-foreground"> (edited)</span>}
									</div>
								)}
								{(replyCounts.get(m.id) ?? 0) > 0 && (
									<AnimateIcon animateOnHover asChild>
										<button type="button" onClick={() => onOpenThread(m)} className="mt-1 flex h-6 cursor-pointer items-center gap-1 font-mono text-[13px] text-primary outline-none hover:underline">
											<MessagesSquare className="size-3.5" />
											{replyCounts.get(m.id)} {replyCounts.get(m.id) === 1 ? "reply" : "replies"}
										</button>
									</AnimateIcon>
								)}
								{m.reactions.length > 0 && !m.deleted && (
									<div className="mt-1 flex flex-wrap gap-1">
										{m.reactions.map((r) => {
											const reacted = r.authors.includes(me);
											return (
												<button
													key={r.emoji}
													type="button"
													disabled={!canPost}
													onClick={() => onReact(m, r.emoji)}
													aria-pressed={reacted}
													aria-label={`${r.emoji} ${r.authors.length}${reacted ? ", you reacted" : ""}`}
													className={cn("flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-[13px] disabled:cursor-default", reacted ? "bg-primary/20 text-foreground outline outline-1 -outline-offset-1 outline-primary" : "bg-muted hover:bg-muted/70")}
												>
													<span>{r.emoji}</span>
													<span className="font-mono tabular-nums">{r.authors.length}</span>
												</button>
											);
										})}
									</div>
								)}
							</div>
							{!m.deleted && canPost && editing !== m.id && (
								<div className={cn("absolute -top-3 right-4 z-10 hidden items-center gap-1 rounded-md bg-popover p-1 ring-1 ring-foreground/10 group-hover:flex group-focus-within:flex", picker === m.id && "flex")}>
									{picker === m.id ? (
										EMOJI.map((e) => (
											<button
												key={e}
												type="button"
												aria-label={`React with ${e}`}
												onClick={() => {
													onReact(m, e);
													setPicker(null);
												}}
												className="flex size-7 cursor-pointer items-center justify-center rounded-md hover:bg-muted"
											>
												{e}
											</button>
										))
									) : (
										<>
											<ActionButton label="Add reaction" onClick={() => setPicker(m.id)} icon={<SmilePlus className="size-4" />} />
											<ActionButton label="Reply" onClick={() => onReply(m)} icon={<CornerUpLeft className="size-4" />} />
											<ActionButton label="Open thread" onClick={() => onOpenThread(m)} icon={<MessagesSquare className="size-4" />} />
											{onMakeTask && <ActionButton label="Make a task from this message" onClick={() => onMakeTask(m)} icon={<ListTodo className="size-4" />} />}
											{mine && <ActionButton label="Edit message" onClick={() => setEditing(m.id)} icon={<Pencil className="size-4" />} />}
											{(mine || isAdmin) && <ActionButton label="Delete message" onClick={() => onDelete(m)} icon={<Trash2 className="size-4" />} danger />}
										</>
									)}
								</div>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

function ActionButton({ label, onClick, icon, danger }: { label: string; onClick: () => void; icon: React.ReactNode; danger?: boolean }) {
	return (
		<Button variant="ghost" size="icon-xs" aria-label={label} onPress={onClick} className={cn("text-muted-foreground", danger ? "hover:text-destructive" : "hover:text-foreground")}>
			{icon}
		</Button>
	);
}

// Editing a message where it stands: Enter saves, Escape cancels
function InlineEdit({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) {
	const [text, setText] = useState(initial);
	return (
		<div className="mt-1 rounded-lg bg-input p-2">
			<textarea
				autoFocus
				value={text}
				aria-label="Edit message"
				rows={Math.min(8, text.split("\n").length)}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						onSave(text);
					} else if (e.key === "Escape") {
						e.stopPropagation();
						onCancel();
					}
				}}
				className="w-full resize-none bg-transparent text-sm outline-none"
			/>
			<p className="font-mono text-[13px] text-muted-foreground">
				Escape to <button type="button" onClick={onCancel} className="cursor-pointer text-primary">cancel</button>, Enter to{" "}
				<button type="button" onClick={() => onSave(text)} className="cursor-pointer text-primary">save</button>
			</p>
		</div>
	);
}
