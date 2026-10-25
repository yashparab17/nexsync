// Comments on a document: the highlight in the page, the panel beside it and the dialog for a new one. Threads live in the signed
// log like those of notes (see features/editor/components/useFileComments.tsx); only where a comment sits differs.

import { TextSelection } from "@tiptap/pm/state";
import { useEffect, useMemo, useState } from "react";

import CommentsPanel from "@/features/editor/components/CommentsPanel";
import NewCommentDialog from "@/features/editor/components/NewCommentDialog";
import type { Placement } from "@/features/chat/lib/anchors";
import { buildThreads, docChannel, type Thread, type ThreadComment } from "@/features/chat/lib/entries";
import { plainPreview } from "@/features/chat/lib/preview";
import { encodeMentions } from "@/features/chat/lib/mentions";
import { type CommentStore, locateDocAnchor, makeDocAnchor, refreshComments } from "@/features/office/documents/lib/documentComments";
import type { documentSchema } from "@/features/office/documents/lib/documentSchema";
import { useChat } from "@/store/chat/ChatContext";

type Editor = typeof documentSchema.BlockNoteEditor;

export function useDocumentComments(editor: Editor, store: CommentStore, path: string, canComment: boolean) {
	const chat = useChat();
	const channel = docChannel(path);
	const threads = useMemo(() => buildThreads(chat.entries, channel), [chat.entries, channel]);
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState<string | null>(null);
	const [composing, setComposing] = useState<{ from: number; to: number } | null>(null);
	const [tick, setTick] = useState(0);

	store.onOpen = (id) => {
		setActive(id);
		setOpen(true);
	};

	// Tell the page what to highlight, and work out where each comment is again a moment after the text changes
	useEffect(() => {
		store.threads = threads.filter((t) => !t.resolved && t.anchor).map((t) => ({ id: t.id, anchor: t.anchor! }));
		store.active = active;
		try {
			refreshComments(editor.prosemirrorView);
		} catch {
			// The page is not mounted yet; the plugin reads the store when it is
		}
	}, [editor, store, threads, active]);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const off = editor.onChange(() => {
			clearTimeout(timer);
			timer = setTimeout(() => setTick((t) => t + 1), 150);
		});
		return () => {
			off?.();
			clearTimeout(timer);
		};
	}, [editor]);
	const placements = useMemo(() => {
		const out = new Map<string, Placement | null>();
		for (const t of threads) out.set(t.id, t.anchor ? locateDocAnchor(editor.prosemirrorState.doc as never, t.anchor) : null);
		return out;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [threads, editor, tick]);

	const start = () => {
		if (!canComment) return;
		const { from, to } = editor.prosemirrorState.selection;
		if (to > from && makeDocAnchor(editor.prosemirrorState.doc as never, from, to)) {
			setComposing({ from, to });
			return;
		}
		setOpen(true);
	};

	const activate = (id: string) => {
		setActive(id);
		const at = placements.get(id);
		if (at && at.state !== "orphaned") {
			const view = editor.prosemirrorView;
			view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at.from, at.to)).scrollIntoView());
			view.focus();
		}
	};

	const text = (value: string) => JSON.stringify({ text: encodeMentions(value, chat.people) });
	const isAdmin = chat.role === "Owner" || chat.role === "Admin";

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
			suggestions={[]}
			onReact={(c, emoji) => chat.toggleReaction(channel, c.id, emoji, c.reactions)}
			following={chat.follows.has(channel)}
			onFollow={(on) => chat.follow(channel, on)}
		/>
	) : null;

	const dialog = composing ? (
		<NewCommentDialog
			quote={editor.prosemirrorState.doc.textBetween(composing.from, composing.to, " ")}
			onClose={() => setComposing(null)}
			onSubmit={async (value) => {
				const anchor = makeDocAnchor(editor.prosemirrorState.doc as never, composing.from, composing.to);
				if (!anchor) throw new Error("That part of the text is not there any more.");
				const entry = await chat.post({ kind: "comment", channel, body: JSON.stringify({ text: encodeMentions(value, chat.people), anchor }) });
				if (entry) {
					setOpen(true);
					setActive(entry.id);
				}
			}}
		/>
	) : null;

	// The open comments as HTML to add at the end of a copy (the file formats here carry no comments), so a copy does not lose what was said
	const appendix = () => {
		const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
		const live = threads.filter((t) => !t.resolved && t.comments.some((c) => !c.deleted));
		if (live.length === 0) return "";
		return `<h2>Comments</h2>${live.map((t) => `<p><em>${esc(t.anchor?.quote ? `"${t.anchor.quote.slice(0, 80)}"` : "Comment")}</em></p>${t.comments.filter((c) => !c.deleted).map((c) => `<p>${esc(c.name)}: ${esc(plainPreview(c.text, chat.people, 100_000))}</p>`).join("")}`).join("")}`;
	};

	// The open comments as the file writer takes them, to be written as the format's own comments
	const list = (anonymous: boolean) =>
		threads
			.filter((t) => !t.resolved && t.anchor?.quote)
			.flatMap((t) => {
				const [first, ...rest] = t.comments.filter((c) => !c.deleted);
				const at = (ts: number) => new Date(ts).toISOString();
				const who = (name: string) => (anonymous ? "Author" : name);
				return first ? [{ quote: t.anchor!.quote, author: who(first.name), text: plainPreview(first.text, chat.people, 100_000), date: at(first.ts), resolved: false, replies: rest.map((c) => ({ author: who(c.name), text: plainPreview(c.text, chat.people, 100_000), date: at(c.ts) })) }] : [];
			});

	return { open, toggle: () => setOpen((v) => !v), start, appendix, list, count: threads.filter((t) => !t.resolved).length, panel, dialog };
}
