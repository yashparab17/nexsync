// Chat: channels on the left, the conversation in the middle, the people on the right, in the manner of Discord and Fluxer.
// Messages are entries of the signed log (see src/lib/chat); this page only reads them and writes new ones.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import ChannelList from "@/components/chat/ChannelList";
import Composer from "@/components/chat/Composer";
import { MAX_ATTACHMENT, MAX_ATTACHMENTS } from "@/components/chat/Attachment";
import ThreadPanel from "@/components/chat/ThreadPanel";
import { fileToBase64 } from "@/lib/assets/uploadScale";
import { safeUploadName } from "@/lib/validation";
import MemberList from "@/components/chat/MemberList";
import MessageList from "@/components/chat/MessageList";
import { AnimateIcon, Bell, BellOff, Download, Hash, Moon, Timer, Users } from "@/components/animate-icons";
import { EmptyState, Page } from "@/components/layout/Page";
import Toolbar, { ToolbarSelect, ToolbarTitle } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/elements/Avatar";
import { buildMessages, type Channel, channelMarkdown, GENERAL, lateIds, replyCounts, slugify, threadRoot, type Message } from "@/lib/chat/entries";
import { exportNote } from "@/lib/export";
import { whoIsTyping } from "@/lib/p2p/presence";
import { decodeMentions } from "@/lib/chat/mentions";
import { canEditRole } from "@/lib/roles";
import { routeForChannel } from "@/lib/chat/routes";
import { plainPreview } from "@/lib/chat/preview";
import { resolveLink } from "@/lib/notes/links";
import { createTask, getKanban, getTasks, listWorkspaceFiles, writeWorkspaceBinaryFile } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useChat } from "@/store/chat/ChatContext";
import { useP2P, useSelfRole } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { KanbanCard, Task, WorkspaceFile } from "@/types/workspace";

export default function WorkspaceChat() {
	const { workspace, metadata } = useWorkspace();
	const { peers, publishDataChange, dataVersion, presence, setMyPresence } = useP2P();
	const role = useSelfRole();
	const chat = useChat();
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();

	const [active, setActive] = useState(GENERAL);
	const [showMembers, setShowMembers] = useState(true);
	const [reply, setReply] = useState<Message | null>(null);
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [divider, setDivider] = useState<string | null>(null);
	const [notes, setNotes] = useState<WorkspaceFile[]>([]);
	const [tasks, setTasks] = useState<Task[]>([]);
	const [cards, setCards] = useState<KanbanCard[]>([]);
	const [notice, setNotice] = useState<string | null>(null);
	const [threadId, setThreadId] = useState<string | null>(null);
	const [pending, setPending] = useState<File[]>([]);
	// A conversation with one person, in place of a channel
	const [dmWith, setDmWith] = useState<string | null>(null);

	const isAdmin = role === "Owner" || role === "Admin";
	const base = chat.channels.find((c) => c.id === active) ?? chat.channels[0];
	const conversation = dmWith ? chat.conversations.get(dmWith) : undefined;
	const dmPerson = dmWith ? chat.people.find((p) => p.deviceId === dmWith) : undefined;
	const channel: Channel = dmWith
		? { id: conversation?.channel ?? `dm.${dmWith}`, name: dmPerson?.name ?? "someone", topic: "Only the two of you can read this: the words are sealed", archived: false, slowSeconds: 0 }
		: base;
	const messages = useMemo(() => (dmWith ? (conversation?.messages ?? []) : buildMessages(chat.entries, base.id)), [dmWith, conversation, chat.entries, base.id]);
	const members = metadata?.members.members ?? [];

	// A link from the inbox opens the channel it is about
	useEffect(() => {
		const wanted = params.get("channel");
		if (!wanted) return;
		if (wanted.startsWith("dm.")) {
			// "dm.<key>.<key>": the conversation is with whichever of the two is not this device
			const [, a, b] = wanted.split(".");
			setDmWith(a === chat.me ? b : a);
		} else if (chat.channels.some((c) => c.id === wanted)) {
			setDmWith(null);
			setActive(wanted);
		}
		setParams({}, { replace: true });
	}, [params, setParams, chat.channels, chat.me]);

	// Where the unread messages begin, worked out once when a channel is opened
	const opened = useRef<string | null>(null);
	useEffect(() => {
		if (!chat.me || opened.current === channel.id) return;
		opened.current = channel.id;
		const lastRead = chat.read[channel.id]?.lastTs ?? 0;
		setDivider(messages.find((m) => m.author !== chat.me && m.ts > lastRead && !m.deleted)?.id ?? null);
	}, [channel.id, chat.me, chat.read, messages]);

	// Reading is being here with the window in front
	useEffect(() => {
		const mark = () => document.hasFocus() && chat.markRead(channel.id);
		mark();
		window.addEventListener("focus", mark);
		return () => window.removeEventListener("focus", mark);
	}, [chat, channel.id, messages.length]);

	// Notes a message links to with [[Name]]
	useEffect(() => {
		if (!workspace?.path) return;
		let live = true;
		listWorkspaceFiles(workspace.path, "notes")
			.then((files) => live && setNotes(files.filter((f) => !f.is_dir)))
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [workspace?.path]);

	// Titles for [[task:id]] and [[card:id]] in messages
	useEffect(() => {
		if (!workspace?.path) return;
		let live = true;
		getTasks(workspace.path).then((t) => live && setTasks(t)).catch(() => {});
		getKanban(workspace.path).then((cols) => live && setCards(cols.flatMap((c) => c.cards))).catch(() => {});
		return () => {
			live = false;
		};
	}, [workspace?.path, dataVersion]);
	const refTitle = useCallback(
		(entity: "task" | "card", id: string) => (entity === "task" ? tasks.find((t) => t.id === id)?.title : cards.find((c) => c.id === id)?.title),
		[tasks, cards],
	);
	const openRef = useCallback((entity: "task" | "card", id: string) => navigate(routeForChannel(`${entity}:${id}`)), [navigate]);

	const openNote = useCallback(
		(name: string) => {
			const note = resolveLink(name, notes);
			if (note) navigate(`/workspace/notes?open=${encodeURIComponent(note.path)}`);
		},
		[notes, navigate],
	);

	const online = useMemo(() => new Set([chat.myName, ...peers.map((p) => p.name)]), [chat.myName, peers]);

	const attach = (files: File[]) => {
		const room = MAX_ATTACHMENTS - pending.length;
		const fit = files.filter((f) => f.size <= MAX_ATTACHMENT).slice(0, Math.max(0, room));
		if (fit.length < files.length) setNotice(`Up to ${MAX_ATTACHMENTS} files of 10 MB each go with a message; some were left out.`);
		setPending((p) => [...p, ...fit]);
	};

	// Files are written into the workspace when the message is sent, so a file taken back out leaves nothing behind
	const upload = async (files: File[]): Promise<string[]> => {
		if (!workspace?.path) return [];
		const tokens: string[] = [];
		for (const file of files) {
			const path = `assets/chat/${crypto.randomUUID().slice(0, 8)}-${safeUploadName(file.name)}`;
			await writeWorkspaceBinaryFile(workspace.path, path, await fileToBase64(file, 100));
			tokens.push(`[[file:${path}]]`);
		}
		return tokens;
	};

	const send = async (text: string) => {
		const parent = reply?.id ?? "";
		const files = pending;
		if (files.length > 0) {
			try {
				const tokens = await upload(files);
				text = [text, ...tokens].filter(Boolean).join("\n");
				setPending([]);
			} catch (err) {
				setNotice(err instanceof Error ? err.message : String(err));
				return;
			}
		}
		setDrafts((d) => ({ ...d, [channel.id]: "" }));
		typing("");
		setReply(null);
		if (dmWith) {
			void chat.sendDirect(dmWith, text).catch((err) => {
				setDrafts((d) => ({ ...d, [channel.id]: text }));
				setNotice(err instanceof Error ? err.message : String(err));
			});
			return;
		}
		void chat.post({ kind: "message", channel: channel.id, parent, body: text, mentions: true }).catch(() => setDrafts((d) => ({ ...d, [channel.id]: text })));
	};

	const react = (m: Message, emoji: string) => {
		const mine = m.reactions.find((r) => r.emoji === emoji)?.authors.includes(chat.me);
		void chat.post({ kind: mine ? "unreact" : "react", channel: channel.id, parent: m.id, body: JSON.stringify({ emoji }) });
	};

	const makeTask = async (m: Message) => {
		if (!workspace?.path) return;
		const text = decodeMentions(m.text, chat.people).trim();
		const now = new Date().toISOString();
		const task: Task = {
			id: crypto.randomUUID(),
			title: plainPreview(m.text, chat.people, 80) || "Task from chat",
			description: `${text}\n\nFrom a message by ${m.name} in #${channel.name}.`,
			status: "todo",
			priority: "medium",
			tags: [],
			created_at: now,
			updated_at: now,
		};
		try {
			await createTask({ path: workspace.path, task });
			publishDataChange({ entity: "task", op: "upsert", task });
			await chat.post({ kind: "message", channel: channel.id, parent: m.id, body: `Made a task: [[task:${task.id}]]` });
			setTasks((prev) => [...prev, task]);
		} catch (err) {
			setNotice(err instanceof Error ? err.message : String(err));
		}
	};

	const exportChannel = async () => {
		if (!workspace?.path) return;
		try {
			const dest = await exportNote(workspace.path, `${channel.name}.md`, channelMarkdown(channel.name, messages, (t) => plainPreview(t, chat.people, 100_000)), "md");
			if (dest) setNotice(`Exported to ${dest}`);
		} catch (err) {
			setNotice(err instanceof Error ? err.message : String(err));
		}
	};

	const setSlow = (seconds: number) =>
		void chat.post({ kind: "channel", channel: channel.id, body: JSON.stringify({ name: channel.name, topic: channel.topic, archived: false, slowSeconds: seconds }) }).catch(() => {});
	// Slow mode applies to everyone below Admin; the wait is counted from this person's last message here
	const cooldownUntil = useMemo(() => {
		if (!channel.slowSeconds || isAdmin) return 0;
		const mine = messages.filter((m) => m.author === chat.me).reduce((t, m) => Math.max(t, m.ts), 0);
		return mine ? mine + channel.slowSeconds * 1000 : 0;
	}, [channel.slowSeconds, isAdmin, messages, chat.me]);
	const counts = useMemo(() => replyCounts(messages), [messages]);
	const thread = useMemo(() => {
		const root = threadId ? messages.find((m) => m.id === threadId) : undefined;
		if (!root) return null;
		const byId = new Map(messages.map((m) => [m.id, m]));
		return { root, replies: messages.filter((m) => m.id !== root.id && threadRoot(byId, m.id) === root.id) };
	}, [messages, threadId]);
	// Who is typing here: told by the others' presence, never stored. It lapses on its own a few seconds after the last key.
	const [tick, setTick] = useState(0);
	const typers = useMemo(() => whoIsTyping(presence, channel.id), [presence, channel.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
	useEffect(() => {
		if (typers.length === 0) return;
		const t = setInterval(() => setTick((n) => n + 1), 2000);
		return () => clearInterval(t);
	}, [typers.length]);
	const stopTyping = useRef<ReturnType<typeof setTimeout> | null>(null);
	const typing = (text: string) => {
		if (stopTyping.current) clearTimeout(stopTyping.current);
		if (dmWith) return;
		if (!text.trim()) return setMyPresence({ typing: undefined });
		setMyPresence({ typing: channel.id });
		stopTyping.current = setTimeout(() => setMyPresence({ typing: undefined }), 5000);
	};
	useEffect(() => () => setMyPresence({ typing: undefined }), [setMyPresence]);
	const late = useMemo(() => lateIds(messages, chat.seen), [messages, chat.seen]);

	const muted = Object.fromEntries(Object.entries(chat.read).map(([id, r]) => [id, r.muted]));

	return (
		<Page>
			<div className="@container flex min-h-0 flex-1">
				<ChannelList
					channels={chat.channels}
					active={channel.id}
					activeDm={dmWith}
					people={chat.people.filter((p) => p.deviceId && p.deviceId !== chat.me).map((p) => ({ key: p.deviceId!, name: p.name, unread: chat.unread[chat.conversations.get(p.deviceId!)?.channel ?? ""] ?? 0 }))}
					onSelectDm={(key) => {
						setDmWith(key);
						setReply(null);
						setThreadId(null);
						setPending([]);
						opened.current = null;
					}}
					unread={chat.unread}
					muted={muted}
					canCreate={isAdmin}
					onSelect={(id) => {
						setDmWith(null);
						setActive(id);
						setReply(null);
						setThreadId(null);
						opened.current = null;
					}}
					onCreate={async (name, topic) => {
						const id = slugify(name);
						await chat.post({ kind: "channel", channel: id, body: JSON.stringify({ name, topic }) });
						setActive(id);
					}}
				/>
				<section aria-label={`${dmWith ? "@" : "#"}${channel.name}`} className="flex min-w-0 flex-1 flex-col">
					<Toolbar>
						{dmPerson ? <Avatar name={dmPerson.name} className="size-6 text-xs" /> : <Hash className="size-5 shrink-0 text-muted-foreground" />}
						<ToolbarTitle name={channel.name} />
						{channel.topic && <span className="hidden min-w-0 flex-1 truncate border-l pl-3 font-mono text-[13px] text-muted-foreground @3xl:block">{channel.topic}</span>}
						<span className="flex-1" />
						<div className="flex flex-wrap items-center justify-end gap-1">
						<Button variant="ghost" size="icon-sm" aria-label={muted[channel.id] ? "Unmute channel" : "Mute channel"} onPress={() => chat.setMuted(channel.id, !muted[channel.id])} className="text-muted-foreground">
							{muted[channel.id] ? <BellOff className="size-4" /> : <Bell className="size-4" />}
						</Button>
						{dmWith ? null : isAdmin ? (
							<AnimateIcon animateOnHover asChild>
								<label className="flex items-center gap-2 text-muted-foreground" title="Slow mode: how long people below Admin wait between messages">
									<Timer className="size-4" />
									<ToolbarSelect
										label="Slow mode"
										value={String(channel.slowSeconds)}
										onChange={(v) => setSlow(Number(v))}
										active={channel.slowSeconds > 0}
										options={[...new Set([0, 10, 30, 60, 300, channel.slowSeconds])].map((s) => ({ value: String(s), label: s === 0 ? "Slow Mode Off" : s < 60 ? `${s} Seconds` : `${s / 60} Minute${s > 60 ? "s" : ""}` }))}
									/>
								</label>
							</AnimateIcon>
						) : (
							channel.slowSeconds > 0 && (
								<span title="Slow mode: wait between messages" className="flex items-center gap-1 font-mono text-[13px] text-muted-foreground">
									<Timer className="size-4" />
									{channel.slowSeconds}s
								</span>
							)
						)}
						<Button variant="ghost" size="icon-sm" aria-label="Export channel as Markdown" onPress={() => void exportChannel()} className="text-muted-foreground">
							<Download className="size-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={chat.dnd ? "Turn off Do not disturb" : "Turn on Do not disturb"}
							aria-pressed={chat.dnd}
							onPress={() => chat.setDnd(!chat.dnd)}
							className={chat.dnd ? "text-warning" : "text-muted-foreground"}
						>
							<Moon className="size-4" />
						</Button>
						<Button variant="ghost" size="icon-sm" aria-label={showMembers ? "Hide members" : "Show members"} aria-pressed={showMembers} onPress={() => setShowMembers((v) => !v)} className={cn("hidden @4xl:inline-flex", showMembers ? "text-foreground" : "text-muted-foreground")}>
							<Users className="size-4" />
						</Button>
						</div>
					</Toolbar>
					{notice && (
						<p role="status" className="flex h-8 shrink-0 items-center justify-between gap-4 bg-muted px-4 text-[13px]">
							{notice}
							<Button variant="ghost" size="icon-xs" aria-label="Dismiss" onPress={() => setNotice(null)}>
								<X className="size-3.5" />
							</Button>
						</p>
					)}
					{messages.length === 0 ? (
						<EmptyState art={dmWith ? "direct" : "chat"} title={dmWith ? `Your Conversation With ${channel.name}` : `Welcome to #${channel.name}`}>
							{dmWith
								? "Only the two of you can read what is written here: it is sealed to your two device keys, so even the device that passes it on cannot read it. Who wrote to whom, and when, is not hidden."
								: "This is the start of the channel. Messages are signed with each person's device key and travel directly between devices, with no server in between."}
						</EmptyState>
					) : (
						<MessageList
							messages={messages}
							people={chat.people}
							me={chat.me}
							removed={chat.removed}
							canPost={chat.canPost && !dmWith}
							isAdmin={isAdmin}
							firstUnreadId={divider}
							onReply={(m) => setReply(m)}
							onSaveEdit={(m, text) => void chat.post({ kind: "edit", channel: channel.id, parent: m.id, body: text, mentions: true })}
							onDelete={(m) => void chat.post({ kind: "delete", channel: channel.id, parent: m.id, body: "" })}
							onReact={react}
							onOpenNote={openNote}
							late={late}
							refTitle={refTitle}
							onOpenRef={openRef}
							replyCounts={counts}
							onOpenThread={(m) => setThreadId(m.id)}
							onMakeTask={canEditRole(role) && !dmWith ? (m) => void makeTask(m) : undefined}
						/>
					)}
					<p aria-live="polite" className="h-5 shrink-0 px-5 font-mono text-[13px] text-muted-foreground">
						{typers.length === 0 ? "" : typers.length === 1 ? `${typers[0]} is typing…` : typers.length === 2 ? `${typers[0]} and ${typers[1]} are typing…` : "Several people are typing…"}
					</p>
					<Composer
						channelName={channel.name}
						symbol={dmWith ? "@" : "#"}
						canPost={chat.canPost}
						people={chat.people}
						reply={reply ? { name: reply.name, text: reply.deleted ? "Message deleted" : plainPreview(reply.text, chat.people) } : null}
						onCancelReply={() => setReply(null)}
						onSend={(t) => void send(t)}
						pending={pending}
						onAttach={canEditRole(role) && !dmWith ? attach : undefined}
						onRemoveAttachment={(i) => setPending((p) => p.filter((_, k) => k !== i))}
						draft={drafts[channel.id] ?? ""}
						onDraft={(text) => {
							setDrafts((d) => ({ ...d, [channel.id]: text }));
							typing(text);
						}}
						cooldownUntil={cooldownUntil}
						focusKey={`${channel.id}:${reply?.id ?? ""}`}
					/>
				</section>
				{thread && (
					<ThreadPanel
						root={thread.root}
						replies={thread.replies}
						channelName={channel.name}
						people={chat.people}
						me={chat.me}
						canPost={chat.canPost}
						cooldownUntil={cooldownUntil}
						refTitle={refTitle}
						onOpenRef={openRef}
						onOpenNote={openNote}
						onSend={(text) => void chat.post({ kind: "message", channel: channel.id, parent: thread.root.id, body: text, mentions: true }).catch(() => {})}
						onClose={() => setThreadId(null)}
					/>
				)}
				<MemberList members={members} online={online} open={showMembers && !thread} />
			</div>
		</Page>
	);
}
