// Comments on one note or code file: the highlight in the editor, the panel beside it, the buttons, and the dialog for a new
// comment. The editor passes its text document and gets back what to mount; threads live in the signed log (see src/lib/chat).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as Y from "yjs";

import CommentsPanel from "@/features/editor/components/CommentsPanel";
import NewCommentDialog from "@/features/editor/components/NewCommentDialog";
import { AnimateIcon, MessageSquarePlus, MessageSquareText } from "@/components/animate-icons";
import { locateAnchor, makeAnchor, type Placement } from "@/features/chat/lib/anchors";
import { buildThreads, docChannel, type Thread, type ThreadComment } from "@/features/chat/lib/entries";
import { encodeMentions } from "@/features/chat/lib/mentions";
import { commentMarks, setCommentThreads } from "@/lib/editor/commentMarks";
import { openProposals, type Proposal } from "@/lib/proposals";
import { cn } from "@/lib/utils";
import { useChat } from "@/store/chat/ChatContext";
import { useSelfRole } from "@/store/p2p/P2PContext";

interface Options {
	path: string; // The file, as the workspace names it
	doc: Y.Doc | null; // The file's shared text document
	canComment: boolean;
}

export interface FileComments {
	extension: Extension; // For the editor's extra extensions
	onReady: (view: EditorView | null) => void; // Tell it when the editor view exists
	startComment: () => void;
	/** The small buttons over the editor's top right corner */
	controls: ReactNode;
	/** The panel to put beside the editor, or null while it is closed */
	panel: ReactNode;
	/** The dialog for a new comment, or null */
	dialog: ReactNode;
}

export function useFileComments({ path, doc, canComment }: Options): FileComments {
	const chat = useChat();
	const role = useSelfRole();
	const channel = docChannel(path);
	const threads = useMemo(() => buildThreads(chat.entries, channel), [chat.entries, channel]);
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState<string | null>(null);
	const [composing, setComposing] = useState<{ from: number; to: number } | null>(null);
	const [hint, setHint] = useState<string | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const [viewTick, setViewTick] = useState(0);
	const [tick, setTick] = useState(0);
	const ytext = useMemo(() => doc?.getText("content") ?? null, [doc]);

	// Open suggestions, for a discussion under each in the panel
	const [suggestions, setSuggestions] = useState<Proposal[]>([]);
	useEffect(() => {
		if (!doc) return setSuggestions([]);
		const map = doc.getMap("proposals");
		const read = () => setSuggestions(openProposals(doc));
		read();
		map.observe(read);
		return () => map.unobserve(read);
	}, [doc]);

	// Where each comment is now; worked out again a moment after the text changes
	useEffect(() => {
		if (!doc) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const changed = () => {
			clearTimeout(timer);
			timer = setTimeout(() => setTick((t) => t + 1), 120);
		};
		doc.on("update", changed);
		return () => {
			doc.off("update", changed);
			clearTimeout(timer);
		};
	}, [doc]);
	const placements = useMemo(() => {
		const out = new Map<string, Placement | null>();
		for (const t of threads) out.set(t.id, doc && ytext && t.anchor ? locateAnchor(doc, ytext, t.anchor) : null);
		return out;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [threads, doc, ytext, tick]);

	// Tell the editor which threads to highlight
	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const marked = threads.filter((t) => !t.resolved && t.anchor).map((t) => ({ id: t.id, anchor: t.anchor! }));
		view.dispatch({ effects: setCommentThreads.of({ threads: marked, active }) });
	}, [threads, active, viewTick]);

	const startComment = useCallback(() => {
		if (!canComment) return;
		const sel = viewRef.current?.state.selection.main;
		if (!sel || sel.empty) {
			setHint("Select some text to comment on");
			setTimeout(() => setHint(null), 2500);
			return;
		}
		setComposing({ from: sel.from, to: sel.to });
	}, [canComment]);
	const startRef = useRef(startComment);
	startRef.current = startComment;

	const extension = useMemo(
		() =>
			doc
				? commentMarks(
						doc,
						doc.getText("content"),
						(id) => {
							setActive(id);
							setOpen(true);
						},
						() => startRef.current(),
					)
				: [],
		[doc],
	);

	const onReady = useCallback((view: EditorView | null) => {
		viewRef.current = view;
		setViewTick((t) => t + 1);
	}, []);

	const activate = (id: string) => {
		setActive(id);
		const at = placements.get(id);
		const view = viewRef.current;
		if (view && at && at.state !== "orphaned") {
			view.dispatch({ selection: { anchor: at.from, head: at.to }, effects: EditorView.scrollIntoView(at.from, { y: "center" }) });
			view.focus();
		}
	};

	const text = (value: string) => JSON.stringify({ text: encodeMentions(value, chat.people) });
	const isAdmin = role === "Owner" || role === "Admin";
	const openCount = threads.filter((t) => !t.resolved).length;

	const controls = (
		<div className="pointer-events-none absolute top-2 right-4 z-10 flex items-center gap-1">
			{hint && <span className="pointer-events-auto rounded-md bg-popover px-2 py-1 text-[13px] ring-1 ring-foreground/10">{hint}</span>}
			{canComment && (
				<AnimateIcon animateOnHover asChild>
					<button type="button" aria-label="Comment on the selected text" title="Comment on the selected text (Ctrl+Alt+M)" onClick={startComment} className="pointer-events-auto flex size-8 cursor-pointer items-center justify-center rounded-md bg-popover text-muted-foreground outline-none ring-1 ring-foreground/10 hover:text-foreground focus-visible:text-foreground">
						<MessageSquarePlus className="size-4" />
					</button>
				</AnimateIcon>
			)}
			<AnimateIcon animateOnHover asChild>
			<button
				type="button"
				aria-label={open ? "Hide comments" : `Show comments${openCount ? `, ${openCount} open` : ""}`}
				aria-pressed={open}
				title="Comments"
				onClick={() => setOpen((v) => !v)}
				className={cn("pointer-events-auto relative flex size-8 cursor-pointer items-center justify-center rounded-md bg-popover ring-1 ring-foreground/10 hover:text-foreground", open ? "text-primary" : "text-muted-foreground")}
			>
				<MessageSquareText className="size-4" />
				{openCount > 0 && <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[13px] leading-none text-primary-foreground">{openCount}</span>}
			</button>
			</AnimateIcon>
		</div>
	);

	const panel = open ? (
		<CommentsPanel
			threads={threads}
			placements={placements}
			active={active}
			people={chat.people}
			me={chat.me}
			removed={chat.removed}
			canComment={canComment}
			isAdmin={isAdmin}
			onActivate={activate}
			onReply={async (t: Thread, value) => void (await chat.post({ kind: "comment", channel, parent: t.id, body: text(value) }))}
			onEdit={async (c: ThreadComment, value) => void (await chat.post({ kind: "edit", channel, parent: c.id, body: text(value) }))}
			onDelete={async (c: ThreadComment) => void (await chat.post({ kind: "delete", channel, parent: c.id, body: "" }))}
			onResolve={async (t: Thread, resolved) => void (await chat.post({ kind: resolved ? "resolve" : "reopen", channel, parent: t.id, body: "" }))}
			onClose={() => setOpen(false)}
			suggestions={suggestions}
			onReact={(c, emoji) => chat.toggleReaction(channel, c.id, emoji, c.reactions)}
			following={chat.follows.has(channel)}
			onFollow={(on) => chat.follow(channel, on)}
		/>
	) : null;

	const dialog =
		composing && ytext ? (
			<NewCommentDialog
				quote={ytext.toString().slice(composing.from, composing.to)}
				onClose={() => setComposing(null)}
				onSubmit={async (value) => {
					const anchor = makeAnchor(ytext, composing.from, composing.to);
					if (!anchor) throw new Error("That part of the text is not there any more.");
					const entry = await chat.post({ kind: "comment", channel, body: JSON.stringify({ text: encodeMentions(value, chat.people), anchor }) });
					if (entry) {
						setOpen(true);
						setActive(entry.id);
					}
				}}
			/>
		) : null;

	return { extension, onReady, startComment, controls, panel, dialog };
}
