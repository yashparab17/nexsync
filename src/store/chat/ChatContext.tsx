// Chat, comments and the inbox of the open workspace: the signed log of entries, what has been read, and what is new for me.
//
// The entries live in the workspace database and travel between devices in the backend (chat.rs). This holds them for the
// views, reloads them when entries arrive from another device, and writes new ones as this device.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { buildChannels, buildConversations, buildMessages, commentText, GENERAL, isThread, unreadCount, type Channel, type Conversation, type EntryKind, type LogEntry, type Reaction } from "@/lib/chat/entries";
import { encodeMentions, type Person } from "@/lib/chat/mentions";
import { EMPTY_VIEW, parseAction, type ModerationAction, type ModerationView, type TimedOutMember } from "@/lib/moderation";
import { canCommentRole } from "@/lib/roles";
import { p2p } from "@/lib/p2p";
import { myName } from "@/lib/p2p/selfName";
import { plainPreview } from "@/lib/chat/preview";
import { dmChannel, dmOpen, dmSeal, chatMarkRead, chatPost, chatSetMuted, chatState, inboxAdd, inboxClear, inboxList, inboxMarkRead, moderationState, type InboxItem } from "@/lib/tauri";
import { useNotifications } from "@/store/notifications/NotificationContext";
import { useP2P, useSelfRole } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

interface ReadMarker {
	lastTs: number;
	muted: boolean;
}

interface ChatContextType {
	active: boolean; // False outside a workspace, where there is no chat
	entries: LogEntry[];
	me: string; // This device's key, empty until the first load
	myName: string;
	people: Person[]; // Members with a device key, for mentions
	canPost: boolean;
	channels: Channel[];
	unread: Record<string, number>; // Unread messages per chat channel, not counting muted channels
	totalUnread: number;
	read: Record<string, ReadMarker>;
	// Writes an entry as this device. Mentions typed as @Name are turned into device keys.
	post: (args: { kind: EntryKind; channel: string; parent?: string; body: string; mentions?: boolean }) => Promise<LogEntry | null>;
	markRead: (channel: string) => void;
	setMuted: (channel: string, muted: boolean) => void;
	inbox: InboxItem[];
	inboxUnread: number;
	markInboxRead: (ids?: number[]) => void;
	clearInbox: () => void;
	// What is in force: timeouts, bans, removals to carry out, approvals waiting, who was removed
	moderation: ModerationView;
	// Whoever was removed from the workspace, by device key
	removed: Set<string>;
	// The names those members went by, for places that know people by name (Insights, blame)
	removedNames: Set<string>;
	// Set while this device is timed out: it may read, but not write
	timedOut: TimedOutMember | null;
	// Writes a moderation act as this device (the backend refuses one this device may not make)
	act: (action: ModerationAction) => Promise<void>;
	// When this device first held each entry, by id
	seen: Record<string, number>;
	// Do not disturb: no badges for chat or the inbox on this device (nothing is lost)
	dnd: boolean;
	setDnd: (on: boolean) => void;
	// Threads on files, tasks and cards this device follows: it is told about comments on them
	follows: Set<string>;
	follow: (channel: string, on: boolean) => void;
	// Gives or takes back this device's emoji on an entry of a channel
	toggleReaction: (channel: string, parent: string, emoji: string, reactions: Reaction[]) => void;
	// Direct messages, by the other device's key: sealed so only the two devices read them
	conversations: Map<string, Conversation>;
	sendDirect: (to: string, text: string) => Promise<void>;
}

const NONE: ChatContextType = {
	active: false,
	entries: [],
	me: "",
	myName: "You",
	people: [],
	canPost: false,
	channels: [{ id: GENERAL, name: "general", topic: "", archived: false, slowSeconds: 0 }],
	unread: {},
	totalUnread: 0,
	read: {},
	post: async () => null,
	markRead: () => {},
	setMuted: () => {},
	inbox: [],
	inboxUnread: 0,
	markInboxRead: () => {},
	clearInbox: () => {},
	moderation: EMPTY_VIEW,
	removed: new Set(),
	removedNames: new Set(),
	timedOut: null,
	act: async () => {},
	seen: {},
	dnd: false,
	setDnd: () => {},
	follows: new Set(),
	follow: () => {},
	toggleReaction: () => {},
	conversations: new Map(),
	sendDirect: async () => {},
};

// Per device and workspace, in this browser's storage; nothing here is needed for the app to work
const stored = <T,>(key: string, fallback: T): T => {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
};
const store = (key: string, value: unknown) => {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* private window or blocked storage */
	}
};

const ChatContext = createContext<ChatContextType>(NONE);

export function ChatProvider({ children }: { children: ReactNode }) {
	const { workspace, metadata } = useWorkspace();
	const path = workspace?.path;
	const role = useSelfRole();
	const { peers, selfName, dataVersion } = useP2P();
	const { setSink } = useNotifications();

	const [entries, setEntries] = useState<LogEntry[]>([]);
	const [me, setMe] = useState("");
	const [read, setRead] = useState<Record<string, ReadMarker>>({});
	const [inbox, setInbox] = useState<InboxItem[]>([]);
	const [moderation, setModeration] = useState<ModerationView>(EMPTY_VIEW);
	const [seen, setSeen] = useState<Record<string, number>>({});
	const followKey = `nexsync-follow:${workspace?.id ?? ""}`;
	const dndKey = `nexsync-dnd:${workspace?.id ?? ""}`;
	// channel -> the newest comment already told about
	const [followed, setFollowed] = useState<Record<string, number>>({});
	const [dnd, setDndState] = useState(false);
	useEffect(() => {
		setFollowed(stored(followKey, {}));
		setDndState(stored(dndKey, false));
	}, [followKey, dndKey]);

	const members = useMemo(() => metadata?.members.members ?? [], [metadata]);
	const owner = members.find((m) => m.role === "Owner")?.name;
	const name = myName(workspace?.id, owner);
	// The owner's member entry may carry no device key: on the owner's own device it is this device, on a joined copy it is the host
	const ownerKey = selfName === null ? me : peers.find((p) => p.isHost)?.id;
	const people = useMemo<Person[]>(() => members.map((m) => ({ name: m.name, deviceId: m.deviceId ?? (m.role === "Owner" ? ownerKey || undefined : undefined) })), [members, ownerKey]);

	// Loads everything; called on opening and whenever entries arrive from another device
	const load = useCallback(async () => {
		if (!path) return;
		try {
			const [state, items, view] = await Promise.all([chatState(path), inboxList(path), moderationState(path)]);
			setModeration(view ?? EMPTY_VIEW);
			setEntries(state.entries);
			setMe(state.me);
			setSeen(state.seen ?? {});
			setRead(Object.fromEntries(state.read.map((r) => [r.channel, { lastTs: r.lastTs, muted: r.muted }])));
			setInbox(items);
		} catch (err) {
			console.error("[chat] Could not load:", err);
		}
	}, [path]);

	useEffect(() => {
		setEntries([]);
		setInbox([]);
		setRead({});
		void load();
	}, [load]);

	// A merge of someone's task or card changes can hold writes for review, which changes the count on the Members screen
	useEffect(() => {
		if (path) void moderationState(path).then((v) => setModeration(v ?? EMPTY_VIEW)).catch(() => {});
	}, [path, dataVersion]);

	// Entries from other devices: reload, but not once for every one of a burst
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		const reload = () => {
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(() => void load(), 150);
		};
		const off = p2p.onLogChanged(reload);
		const offModeration = p2p.onModerationChanged(reload);
		return () => {
			off();
			offModeration();
			if (timer.current) clearTimeout(timer.current);
		};
	}, [load]);

	// Notices the app writes (a member joined, a task was assigned) are kept in the inbox so they survive a restart
	useEffect(() => {
		if (!path) return;
		setSink((text) => {
			void inboxAdd(path, "notice", `n:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, text).then(load);
		});
		return () => setSink(null);
	}, [path, setSink, load]);

	const follow = useCallback<ChatContextType["follow"]>(
		(channel, on) => {
			setFollowed((prev) => {
				if (on === (channel in prev)) return prev;
				const next = { ...prev };
				if (on) next[channel] = Date.now();
				else delete next[channel];
				store(followKey, next);
				return next;
			});
		},
		[followKey],
	);
	const post = useCallback<ChatContextType["post"]>(
		async ({ kind, channel, parent, body, mentions = false }) => {
			if (!path) return null;
			const text = mentions ? encodeMentions(body, people) : body;
			try {
				const entry = await chatPost({ path, kind, channel, parent, body: text, name });
				// Commenting on something follows it
				if (kind === "comment" && isThread(channel)) follow(channel, true);
				setEntries((prev) => (prev.some((e) => e.id === entry.id) ? prev : [...prev, entry]));
				return entry;
			} catch (err) {
				console.error("[chat] Could not post:", err);
				throw err;
			}
		},
		[path, people, name, follow],
	);

	const follows = useMemo(() => new Set(Object.keys(followed)), [followed]);

	// Someone else commented on something this device follows: it goes to the inbox once
	useEffect(() => {
		if (!path || !me) return;
		const fresh = entries.filter((e) => e.kind === "comment" && e.author !== me && e.channel in followed && e.ts > followed[e.channel]);
		if (fresh.length === 0) return;
		const next = { ...followed };
		for (const e of fresh) {
			next[e.channel] = Math.max(next[e.channel], e.ts);
			void inboxAdd(path, "follow", e.id, plainPreview(commentText(e.body), people), e.channel, e.name).catch(() => {});
		}
		setFollowed(next);
		store(followKey, next);
		void load();
	}, [entries, followed, me, path, people, followKey, load]);

	const toggleReaction = useCallback<ChatContextType["toggleReaction"]>(
		(channel, parent, emoji, reactions) => {
			const mine = reactions.find((r) => r.emoji === emoji)?.authors.includes(me);
			void post({ kind: mine ? "unreact" : "react", channel, parent, body: JSON.stringify({ emoji }) }).catch(() => {});
		},
		[post, me],
	);

	const setDnd = useCallback(
		(on: boolean) => {
			setDndState(on);
			store(dndKey, on);
		},
		[dndKey],
	);

	// Direct messages are opened by the backend, which holds the key; each is opened once
	const [opened, setOpened] = useState<Record<string, string>>({});
	const tried = useRef(new Set<string>());
	useEffect(() => {
		const fresh = entries.filter((e) => e.kind === "dm" && !tried.current.has(e.id));
		if (fresh.length === 0) return;
		for (const e of fresh) tried.current.add(e.id);
		void dmOpen(fresh.map((e) => [e.id, e.author, e.body] as [string, string, string]))
			.then((got) => setOpened((prev) => ({ ...prev, ...got })))
			.catch(() => {});
	}, [entries]);
	const conversations = useMemo(() => buildConversations(entries, opened, me), [entries, opened, me]);

	const sendDirect = useCallback<ChatContextType["sendDirect"]>(
		async (to, text) => {
			const [channel, body] = await Promise.all([dmChannel(to), dmSeal(to, text)]);
			const e = await post({ kind: "dm", channel, body });
			// Its own text is known without asking the backend again
			if (e) setOpened((prev) => ({ ...prev, [e.id]: text }));
		},
		[post],
	);

	const channels = useMemo(() => buildChannels(entries), [entries]);

	const unread = useMemo(() => {
		const out: Record<string, number> = {};
		for (const c of channels) {
			if (c.archived || read[c.id]?.muted) continue;
			const n = unreadCount(buildMessages(entries, c.id), read[c.id]?.lastTs ?? 0, me);
			if (n > 0) out[c.id] = n;
		}
		for (const c of conversations.values()) {
			if (read[c.channel]?.muted) continue;
			const n = unreadCount(c.messages, read[c.channel]?.lastTs ?? 0, me);
			if (n > 0) out[c.channel] = n;
		}
		return out;
	}, [channels, entries, read, me, conversations]);

	const markRead = useCallback(
		(channel: string) => {
			if (!path || isThread(channel)) return;
			const newest = entries.filter((e) => e.channel === channel).reduce((t, e) => Math.max(t, e.ts), 0);
			if (newest <= (read[channel]?.lastTs ?? 0)) return;
			setRead((prev) => ({ ...prev, [channel]: { lastTs: newest, muted: prev[channel]?.muted ?? false } }));
			void chatMarkRead(path, channel, newest);
		},
		[path, entries, read],
	);

	const setMuted = useCallback(
		(channel: string, muted: boolean) => {
			if (!path) return;
			setRead((prev) => ({ ...prev, [channel]: { lastTs: prev[channel]?.lastTs ?? 0, muted } }));
			void chatSetMuted(path, channel, muted);
		},
		[path],
	);

	const markInboxRead = useCallback(
		(ids: number[] = []) => {
			if (!path) return;
			setInbox((prev) => prev.map((i) => (ids.length === 0 || ids.includes(i.id) ? { ...i, read: true } : i)));
			void inboxMarkRead(path, ids);
		},
		[path],
	);

	const clearInbox = useCallback(() => {
		if (!path) return;
		setInbox([]);
		void inboxClear(path);
	}, [path]);

	// Timeouts are re-read each half minute, so a timeout is lifted on the screen when it ends
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(t);
	}, []);
	const timedOut = useMemo(() => moderation.state.timeouts.find((t) => t.key === me && t.until > now) ?? null, [moderation, me, now]);
	const removed = useMemo(() => new Set(moderation.removed), [moderation.removed]);

	const removedNames = useMemo(() => {
		const names = new Set<string>();
		for (const e of entries) {
			if (e.kind !== "moderation") continue;
			const a = parseAction(e.body);
			if (a && (a.action === "kick" || a.action === "ban" || a.action === "kicked") && a.target && removed.has(a.target) && a.targetName) names.add(a.targetName);
		}
		return names;
	}, [entries, removed]);

	const act = useCallback<ChatContextType["act"]>(
		async (action) => {
			await post({ kind: "moderation", channel: "moderation", body: JSON.stringify(action) });
		},
		[post],
	);

	const value = useMemo<ChatContextType>(
		() => ({
			active: true,
			entries,
			me,
			myName: name,
			people,
			canPost: canCommentRole(role) && !timedOut && !moderation.state.banned.some((b) => b.key === me),
			channels,
			unread,
			totalUnread: dnd ? 0 : Object.values(unread).reduce((a, b) => a + b, 0),
			read,
			post,
			markRead,
			setMuted,
			inbox,
			inboxUnread: dnd ? 0 : inbox.filter((i) => !i.read).length,
			markInboxRead,
			clearInbox,
			moderation,
			removed,
			removedNames,
			timedOut,
			act,
			seen,
			dnd,
			setDnd,
			follows,
			follow,
			toggleReaction,
			conversations,
			sendDirect,
		}),
		[conversations, sendDirect, removedNames, toggleReaction, seen, dnd, setDnd, follows, follow, entries, me, name, people, role, channels, unread, read, post, markRead, setMuted, inbox, markInboxRead, clearInbox, moderation, removed, timedOut, act],
	);
	return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

// Without a provider (tests, isolated components) there is no chat
export function useChat(): ChatContextType {
	return useContext(ChatContext);
}
