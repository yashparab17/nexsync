import { describe, expect, it } from "vitest";
import { buildConversations, buildChannels, buildMessages, buildThreads, channelMarkdown, lateIds, replyCounts, threadRoot, openThreadCounts, slugify, unreadCount, type LogEntry, type Message } from "@/features/chat/lib/entries";

let n = 0;
const entry = (over: Partial<LogEntry>): LogEntry => ({ id: `e${++n}`, kind: "message", channel: "general", parent: "", author: "A", name: "Ana", ts: 1000, body: "", sig: "s", ...over });

describe("channels", () => {
	it("always has General first and takes the newest entry for each other channel", () => {
		const channels = buildChannels([
			entry({ kind: "channel", channel: "ideas", body: JSON.stringify({ name: "Ideas", topic: "old" }), ts: 1 }),
			entry({ kind: "channel", channel: "ideas", body: JSON.stringify({ name: "Ideas", topic: "new" }), ts: 2 }),
			entry({ kind: "channel", channel: "archive-me", body: JSON.stringify({ name: "Old", archived: true }), ts: 1 }),
		]);
		expect(channels.map((c) => c.id)).toEqual(["general", "ideas", "archive-me"]);
		expect(channels.find((c) => c.id === "ideas")?.topic).toBe("new");
		expect(channels.find((c) => c.id === "archive-me")?.archived).toBe(true);
	});

	it("makes a slug from a name", () => {
		expect(slugify("  Release Plan!  ")).toBe("release-plan");
		expect(slugify("Ünïcode & more")).toBe("unicode-more");
	});

	it("does not list a comment thread as a channel", () => {
		expect(buildChannels([entry({ kind: "channel", channel: "doc:notes/a.md", body: "{}" })]).map((c) => c.id)).toEqual(["general"]);
	});
});

describe("messages", () => {
	it("applies the newest edit, a deletion and the reactions", () => {
		const m = entry({ id: "m1", body: "first", ts: 100 });
		const out = buildMessages(
			[
				m,
				entry({ kind: "edit", parent: "m1", body: "second", ts: 200 }),
				entry({ kind: "edit", parent: "m1", body: "third", ts: 300 }),
				entry({ kind: "react", parent: "m1", author: "B", body: JSON.stringify({ emoji: "👍" }), ts: 150 }),
				entry({ kind: "react", parent: "m1", author: "C", body: JSON.stringify({ emoji: "👍" }), ts: 160 }),
				entry({ kind: "react", parent: "m1", author: "C", body: JSON.stringify({ emoji: "🎉" }), ts: 161 }),
				entry({ kind: "unreact", parent: "m1", author: "C", body: JSON.stringify({ emoji: "🎉" }), ts: 170 }),
			],
			"general",
		);
		expect(out).toHaveLength(1);
		expect(out[0].text).toBe("third");
		expect(out[0].editedAt).toBe(300);
		expect(out[0].reactions).toEqual([{ emoji: "👍", authors: ["B", "C"] }]);
		const gone = buildMessages([m, entry({ kind: "delete", parent: "m1", ts: 400 })], "general");
		expect(gone[0].deleted).toBe(true);
	});

	it("puts a reply after the message it answers even when the writer's clock was behind", () => {
		const out = buildMessages([entry({ id: "r", parent: "p", body: "reply", ts: 50 }), entry({ id: "p", body: "parent", ts: 500 }), entry({ id: "later", body: "later", ts: 600 })], "general");
		expect(out.map((m) => m.id)).toEqual(["p", "r", "later"]);
	});

	it("only shows the channel asked for", () => {
		expect(buildMessages([entry({ channel: "ideas" }), entry({ channel: "general" })], "ideas")).toHaveLength(1);
	});

	it("counts unread messages from others after the marker, leaving out deleted ones", () => {
		const messages = buildMessages([entry({ id: "a", ts: 100 }), entry({ id: "b", ts: 300 }), entry({ id: "c", ts: 400, author: "ME" }), entry({ id: "d", ts: 500 }), entry({ kind: "delete", parent: "d", ts: 600 })], "general");
		expect(unreadCount(messages, 200, "ME")).toBe(1);
		expect(unreadCount(messages, 0, "ME")).toBe(2);
	});
});

describe("comment threads", () => {
	const root = (over: Partial<LogEntry> = {}) =>
		entry({ kind: "comment", channel: "doc:notes/a.md", body: JSON.stringify({ text: "why?", anchor: { from: { t: 1 }, to: { t: 2 }, quote: "the words" } }), ...over });

	it("has the root first, replies in order, the anchor, and can be resolved and reopened", () => {
		const r = root({ id: "root", ts: 100 });
		const threads = buildThreads(
			[
				r,
				entry({ kind: "comment", channel: "doc:notes/a.md", parent: "root", body: JSON.stringify({ text: "because" }), ts: 200, author: "B", name: "Bo" }),
				entry({ kind: "resolve", channel: "doc:notes/a.md", parent: "root", ts: 300, author: "B", name: "Bo" }),
			],
			"doc:notes/a.md",
		);
		expect(threads).toHaveLength(1);
		expect(threads[0].comments.map((c) => c.text)).toEqual(["why?", "because"]);
		expect(threads[0].anchor?.quote).toBe("the words");
		expect(threads[0].resolved).toBe(true);
		expect(threads[0].resolvedBy).toBe("Bo");
		const reopened = buildThreads([r, entry({ kind: "resolve", channel: "doc:notes/a.md", parent: "root", ts: 300 }), entry({ kind: "reopen", channel: "doc:notes/a.md", parent: "root", ts: 400 })], "doc:notes/a.md");
		expect(reopened[0].resolved).toBe(false);
	});

	it("leaves out a thread whose comments were all deleted, and edits and deletes inside one", () => {
		const r = root({ id: "root", ts: 100 });
		const edited = buildThreads([r, entry({ kind: "edit", channel: "doc:notes/a.md", parent: "root", body: JSON.stringify({ text: "better" }), ts: 150 })], "doc:notes/a.md");
		expect(edited[0].comments[0].text).toBe("better");
		expect(edited[0].comments[0].editedAt).toBe(150);
		expect(buildThreads([r, entry({ kind: "delete", channel: "doc:notes/a.md", parent: "root", ts: 200 })], "doc:notes/a.md")).toEqual([]);
	});

	it("keeps the field a discussion of a conflict is about", () => {
		const r = entry({ id: "f", kind: "comment", channel: "task:1", body: JSON.stringify({ text: "which one?", field: "due_date" }) });
		const t = buildThreads([r], "task:1");
		expect(t[0].field).toBe("due_date");
		expect(t[0].anchor).toBeNull();
	});

	it("counts open threads per channel", () => {
		const a = root({ id: "a" });
		const b = root({ id: "b", channel: "task:1" });
		const c = root({ id: "c", channel: "task:1" });
		const counts = openThreadCounts([a, b, c, entry({ kind: "resolve", channel: "task:1", parent: "c", ts: 2000 })]);
		expect([...counts.entries()].sort()).toEqual([
			["doc:notes/a.md", 1],
			["task:1", 1],
		]);
	});
});

describe("arrived late, slow mode and export", () => {
	const m = (id: string, ts: number): Message => ({ id, author: "a", name: "A", ts, text: id, editedAt: null, deleted: false, replyTo: "", reactions: [] });
	it("marks a message held long after it was written, behind a newer one", () => {
		const day = 24 * 3_600_000;
		const msgs = [m("old", 1_000), m("new", 2_000)];
		// "new" was held first, "old" a day later
		expect([...lateIds(msgs, { new: 2_000, old: 1_000 + day })]).toEqual(["old"]);
	});
	it("does not mark a batch that arrived together, or a message held close to when it was written", () => {
		const msgs = [m("old", 1_000), m("new", 2_000)];
		expect(lateIds(msgs, { new: 500_000, old: 500_001 }).size).toBe(0);
		expect(lateIds(msgs, { new: 2_000, old: 1_500 }).size).toBe(0);
		expect(lateIds(msgs, {}).size).toBe(0);
	});
	it("reads the slow mode of a channel from its newest entry", () => {
		const e = (ts: number, body: object): LogEntry => ({ id: String(ts), kind: "channel", channel: "ops", parent: "", author: "a", name: "A", ts, body: JSON.stringify(body), sig: "" });
		expect(buildChannels([e(1, { name: "ops", slowSeconds: 30 }), e(2, { name: "ops", slowSeconds: 0 })]).find((c) => c.id === "ops")?.slowSeconds).toBe(0);
		expect(buildChannels([e(1, { name: "ops", slowSeconds: 30 })]).find((c) => c.id === "ops")?.slowSeconds).toBe(30);
	});
	it("writes a channel and its comments as Markdown", () => {
		expect(channelMarkdown("general", [m("hello", 0)], (x) => x)).toContain("hello");
	});
});

describe("pinned comments and reply counts", () => {
	it("reads a pin from the root comment and ignores one outside the picture", () => {
		const e = (id: string, point: unknown): LogEntry => ({ id, kind: "comment", channel: "doc:assets/a.png", parent: "", author: "a", name: "A", ts: 1, body: JSON.stringify({ text: "here", point }), sig: "" });
		const threads = buildThreads([e("1", { x: 0.25, y: 0.5 }), e("2", { x: 3, y: 0 })], "doc:assets/a.png");
		expect(threads.find((t) => t.id === "1")?.point).toEqual({ x: 0.25, y: 0.5 });
		expect(threads.find((t) => t.id === "2")?.point).toBeNull();
	});
	it("counts replies through other replies and finds the top of a chain", () => {
		const m = (id: string, replyTo = ""): Message => ({ id, author: "a", name: "A", ts: 1, text: id, editedAt: null, deleted: false, replyTo, reactions: [] });
		const list = [m("a"), m("b", "a"), m("c", "b"), m("d")];
		expect(replyCounts(list).get("a")).toBe(2);
		expect(replyCounts(list).get("d")).toBeUndefined();
		expect(threadRoot(new Map(list.map((x) => [x.id, x])), "c")).toBe("a");
	});
});

describe("direct messages", () => {
	const dm = (id: string, author: string, to: string, ts: number): LogEntry => ({ id, kind: "dm", channel: "dm.a.b", parent: "", author, name: author, ts, body: JSON.stringify({ to, box: "x" }), sig: "" });
	it("groups opened messages by the other device and leaves out the ones it could not open", () => {
		const entries = [dm("2", "me", "bo", 20), dm("1", "bo", "me", 10), dm("3", "cy", "bo", 30), dm("4", "bo", "me", 40)];
		const c = buildConversations(entries, { "1": "hi", "2": "hello", "3": "secret between others", "4": "later" }, "me");
		expect([...c.keys()].sort()).toEqual(["bo", "cy"]);
		expect(c.get("bo")?.messages.map((m) => m.text)).toEqual(["hi", "hello", "later"]);
		// Without its text an entry is not shown
		expect(buildConversations(entries, { "1": "hi" }, "me").get("bo")?.messages).toHaveLength(1);
		expect(buildConversations(entries, {}, "").size).toBe(0);
	});
});
