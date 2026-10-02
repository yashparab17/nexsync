import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as Y from "yjs";

import { LiveJournal } from "./liveJournal";
import { P2PSyncProvider } from "./P2PSyncProvider";
import type { P2PMessage } from "./types";

describe("LiveJournal", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("joins keystrokes into one entry after a quiet spell", () => {
		const sink = vi.fn();
		const j = new LiveJournal(sink, 1000);
		j.record("a", "Sam", "", "h");
		j.record("a", "Sam", "h", "hi");
		j.record("a", "Sam", "hi", "hi!");
		expect(sink).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1000);
		expect(sink).toHaveBeenCalledTimes(1);
		expect(sink).toHaveBeenCalledWith("a", "Sam", "", "hi!");
	});

	it("never credits a collaborator with typing done here in between", () => {
		const sink = vi.fn();
		const j = new LiveJournal(sink, 1000);
		j.record("a", "Sam", "one", "one two");
		// this device typed " three" before Sam's next change arrived
		j.record("a", "Sam", "one two three", "one two three four");
		j.flush();
		expect(sink).toHaveBeenNthCalledWith(1, "a", "Sam", "one", "one two");
		expect(sink).toHaveBeenNthCalledWith(2, "a", "Sam", "one two three", "one two three four");
	});

	it("keeps two people's typing apart, and two notes apart", () => {
		const sink = vi.fn();
		const j = new LiveJournal(sink, 1000);
		j.record("a", "Sam", "", "x");
		j.record("a", "Kim", "x", "xy");
		j.record("b", "Sam", "", "z");
		j.flush();
		expect(sink).toHaveBeenCalledTimes(3);
	});

	it("hears a peer's typing through the sync provider, with the author the backend stamped", () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		const sent: P2PMessage[] = [];
		new P2PSyncProvider(a, (m) => sent.push(m), "notes/x.md").addPeer("b");
		const heard: unknown[][] = [];
		const provider = new P2PSyncProvider(b, () => {}, "notes/x.md", null, (...args) => heard.push(args));
		provider.addPeer("a");
		a.getText("content").insert(0, "hello");
		const update = sent.find((m) => m.kind === "SYNC_UPDATE")!;
		provider.handleMessage("a", { ...update, author: "Sam" });
		expect(heard).toEqual([["notes/x.md", "Sam", "", "hello"]]);
	});

	it("ignores a change that changed nothing", () => {
		const sink = vi.fn();
		const j = new LiveJournal(sink, 1000);
		j.record("a", "Sam", "same", "same");
		j.flush();
		expect(sink).not.toHaveBeenCalled();
	});
});
