// The comment threads of the open file, down the right of the editor: each shows the words it is about (and says when they
// moved, changed or were deleted), the conversation, a reply box, and Resolve or Reopen.

import { useState } from "react";
import { X } from "lucide-react";

import ReactionBar from "@/features/chat/components/ReactionBar";
import DiscussToggle from "@/components/elements/DiscussToggle";
import type { Proposal } from "@/lib/proposals";
import RichText from "@/features/chat/components/RichText";
import { AnimateIcon, Bell, BellRing, Check, CornerUpLeft, Pencil, RotateCcw, Trash2 } from "@/components/animate-icons";
import Toolbar from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/elements/Avatar";
import { MessageSquareText } from "@/components/animate-icons";
import { decodeMentions, type Person } from "@/features/chat/lib/mentions";
import type { Thread, ThreadComment } from "@/features/chat/lib/entries";
import type { Placement } from "@/features/chat/lib/anchors";
import { cn } from "@/lib/utils";

export interface CommentsPanelProps {
	threads: Thread[];
	placements: Map<string, Placement | null>;
	active: string | null;
	people: Person[];
	me: string;
	removed?: Set<string>;
	canComment: boolean;
	isAdmin: boolean;
	onActivate: (id: string) => void;
	onReply: (thread: Thread, text: string) => Promise<void>;
	onEdit: (comment: ThreadComment, text: string) => Promise<void>;
	onDelete: (comment: ThreadComment) => Promise<void>;
	onResolve: (thread: Thread, resolved: boolean) => Promise<void>;
	onClose: () => void;
	onReact: (comment: ThreadComment, emoji: string) => void;
	// Open suggestions of this file, each with a discussion of its own
	suggestions?: Proposal[];
	// Whether this device is told about new comments on the file, and the switch for it
	following: boolean;
	onFollow: (on: boolean) => void;
}

const when = (ts: number) => new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function CommentsPanel(props: CommentsPanelProps) {
	const [tab, setTab] = useState<"open" | "resolved">("open");
	const open = props.threads.filter((t) => !t.resolved);
	const resolved = props.threads.filter((t) => t.resolved);
	const shown = tab === "open" ? open : resolved;
	return (
		<aside aria-label="Comments" className="flex h-full w-80 shrink-0 flex-col bg-panel">
			<Toolbar variant="header" className="gap-2">
				<MessageSquareText className="size-5 text-primary" />
				<h2 className="flex-1 text-sm font-semibold">Comments</h2>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-pressed={props.following}
					aria-label={props.following ? "Stop following this file" : "Follow this file"}
					onPress={() => props.onFollow(!props.following)}
					className={props.following ? "text-primary" : "text-muted-foreground"}
				>
					{props.following ? <BellRing className="size-4" /> : <Bell className="size-4" />}
				</Button>
				<Button variant="ghost" size="icon-sm" aria-label="Close comments" onPress={props.onClose} className="text-muted-foreground">
					<X className="size-4" />
				</Button>
			</Toolbar>
			<div role="tablist" aria-label="Which comments" className="flex shrink-0 gap-1 px-3 pb-2">
				{(
					[
						["open", `Open / ${open.length}`],
						["resolved", `Resolved / ${resolved.length}`],
					] as const
				).map(([id, label]) => (
					<button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("h-8 cursor-pointer rounded-md px-3 font-mono text-[13px]", tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
						{label}
					</button>
				))}
			</div>
			<div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
				{shown.length === 0 && (
					<p className="px-1 py-6 text-center text-sm text-muted-foreground">
						{tab === "open" ? (props.canComment ? "No open comments. Select some text and choose Comment to start one." : "No open comments.") : "Nothing resolved yet."}
					</p>
				)}
				{shown.map((t) => (
					<ThreadCard key={t.id} thread={t} placement={props.placements.get(t.id) ?? null} {...props} />
				))}
				{tab === "open" && (props.suggestions?.length ?? 0) > 0 && (
					<section aria-label="Suggestions" className="space-y-2 pt-2">
						<h3 className="px-1 font-mono text-[13px] text-muted-foreground">Suggestions / {props.suggestions!.length}</h3>
						{props.suggestions!.map((p) => (
							<div key={p.id} className="frame space-y-1 bg-muted/40 p-3">
								<p className="text-[13px] text-muted-foreground">{p.by} suggests</p>
								<p className="line-clamp-3 font-mono text-[13px]">{p.text || "(delete this text)"}</p>
								<DiscussToggle channel={`suggestion:${p.id}`} canComment={props.canComment} />
							</div>
						))}
					</section>
				)}
			</div>
		</aside>
	);
}

function ThreadCard({ thread, placement, active, people, me, removed, canComment, isAdmin, onActivate, onReply, onEdit, onDelete, onResolve, onReact }: CommentsPanelProps & { thread: Thread; placement: Placement | null }) {
	const [text, setText] = useState("");
	const [editing, setEditing] = useState<string | null>(null);
	const [editText, setEditText] = useState("");
	const [busy, setBusy] = useState(false);

	const note =
		placement?.state === "orphaned" ? "The text this was on is gone" : placement?.state === "moved" ? "The text moved" : placement?.state === "changed" ? "The text was edited" : null;

	const reply = async () => {
		if (!text.trim() || busy) return;
		setBusy(true);
		try {
			await onReply(thread, text.trim());
			setText("");
		} finally {
			setBusy(false);
		}
	};

	return (
		<section id={`thread-${thread.id}`} className={cn("frame space-y-2 bg-muted/40 p-3", active === thread.id && "outline-primary!")} aria-label="Comment thread">
			{thread.anchor && (
				<button type="button" onClick={() => onActivate(thread.id)} className="block w-full cursor-pointer text-left">
					<span className="line-clamp-2 border-l-2 border-warning pl-2 font-mono text-[13px] text-muted-foreground">{thread.anchor.quote}</span>
					{note && <span className={cn("mt-1 block text-[13px]", placement?.state === "orphaned" ? "text-destructive" : "text-warning")}>{note}</span>}
				</button>
			)}
			<ul className="space-y-3">
				{thread.comments.map((c) => (
					<li key={c.id} className="group flex gap-2">
						<Avatar name={c.name} className="mt-1 size-6 text-xs" />
						<div className="min-w-0 flex-1">
							<div className="flex items-baseline gap-2">
								<span className="truncate text-sm font-semibold">{c.name}</span>
								{removed?.has(c.author) && <span className="rounded-sm bg-destructive/15 px-1 font-mono text-[13px] text-destructive">Removed</span>}
								<span className="font-mono text-[13px] text-muted-foreground">{when(c.ts)}</span>
							</div>
							{c.deleted ? (
								<p className="text-sm text-muted-foreground italic">Comment deleted</p>
							) : editing === c.id ? (
								<div className="mt-1 space-y-1">
									<textarea
										autoFocus
										value={editText}
										aria-label="Edit comment"
										rows={2}
										onChange={(e) => setEditText(e.target.value)}
										className="w-full resize-none rounded-md bg-input p-2 text-sm outline-none"
									/>
									<div className="flex gap-2 font-mono text-[13px]">
										<button
											type="button"
											className="cursor-pointer text-primary"
											onClick={async () => {
												if (editText.trim() && editText.trim() !== decodeMentions(c.text, people)) await onEdit(c, editText.trim());
												setEditing(null);
											}}
										>
											Save
										</button>
										<button type="button" className="cursor-pointer text-muted-foreground" onClick={() => setEditing(null)}>
											Cancel
										</button>
									</div>
								</div>
							) : (
								<>
									<RichText text={c.text} people={people} me={me} />
									{c.editedAt && <span className="text-[13px] text-muted-foreground">(edited)</span>}
								</>
							)}
							{!c.deleted && <ReactionBar reactions={c.reactions} me={me} canReact={canComment} onReact={(emoji) => onReact(c, emoji)} />}
							{!c.deleted && editing !== c.id && canComment && (c.author === me || isAdmin) && (
								<div className="mt-1 hidden gap-2 group-hover:flex group-focus-within:flex">
									{c.author === me && (
										<Button
											variant="ghost"
											size="icon-xs"
											aria-label="Edit comment"
											onPress={() => {
												setEditing(c.id);
												setEditText(decodeMentions(c.text, people));
											}}
											className="text-muted-foreground"
										>
											<Pencil className="size-3.5" />
										</Button>
									)}
									<Button variant="ghost" size="icon-xs" aria-label="Delete comment" onPress={() => void onDelete(c)} className="text-muted-foreground hover:text-destructive">
										<Trash2 className="size-3.5" />
									</Button>
								</div>
							)}
						</div>
					</li>
				))}
			</ul>
			{thread.resolved && (
				<p className="flex items-center gap-1 text-[13px] text-success">
					<Check className="size-3.5" aria-hidden /> Resolved by {thread.resolvedBy}
				</p>
			)}
			{canComment && (
				<div className="space-y-2">
					{!thread.resolved && (
						<div className="flex items-end gap-2">
							<textarea
								value={text}
								aria-label="Reply"
								placeholder="Reply"
								rows={1}
								maxLength={4000}
								onChange={(e) => setText(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										void reply();
									}
								}}
								className="min-h-8 flex-1 resize-none rounded-md bg-input px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
							/>
							<Button variant="ghost" size="icon-sm" aria-label="Send reply" isDisabled={!text.trim() || busy} onPress={() => void reply()} className="text-primary">
								<CornerUpLeft className="size-4" />
							</Button>
						</div>
					)}
					<AnimateIcon animateOnHover asChild>
						<button type="button" onClick={() => void onResolve(thread, !thread.resolved)} className="flex h-8 cursor-pointer items-center gap-1 font-mono text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
							{thread.resolved ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
							{thread.resolved ? "Reopen" : "Resolve"}
						</button>
					</AnimateIcon>
				</div>
			)}
		</section>
	);
}
