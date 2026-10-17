import { describe, expect, it } from "vitest";
import type { LogEntry } from "@/features/chat/lib/entries";
import { chatHits } from "@/features/chat/lib/search";

let n = 0;
const entry = (over: Partial<LogEntry>): LogEntry => ({ id: `e${++n}`, kind: "message", channel: "general", parent: "", author: "A", name: "Ana", ts: 1000 + n, body: "", sig: "s", ...over });

describe("chatHits", () => {
	it("lists messages and comments with their newest text, leaves out deleted ones, newest first", () => {
		const people = [{ name: "Bo", deviceId: "KB" }];
		const m = entry({ id: "m", body: "first draft for <@KB>" });
		const c = entry({ id: "c", kind: "comment", channel: "doc:notes/a.md", body: JSON.stringify({ text: "why this?" }) });
		const gone = entry({ id: "g", body: "secret" });
		const hits = chatHits([m, c, gone, entry({ kind: "edit", parent: "m", body: "final draft for <@KB>", ts: 5000 }), entry({ kind: "delete", parent: "g" })], people);
		expect(hits.map((h) => [h.id, h.kind, h.text])).toEqual([
			["c", "Comment", "why this?"],
			["m", "Message", "final draft for @Bo"],
		]);
	});
});
