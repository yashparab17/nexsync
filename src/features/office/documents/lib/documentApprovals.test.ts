import { describe, expect, it } from "vitest";

import type { LogEntry } from "@/features/chat/lib/entries";
import { approvalBody, approvalChannel, approvalsOf, hashOf, statusOf } from "@/features/office/documents/lib/documentApprovals";

const people = [{ name: "Ana", deviceId: "A1" }, { name: "Bo", deviceId: "B1" }];
let n = 0;
const entry = (name: string, id: string, ts: number, kind: Parameters<typeof approvalBody>[0], hash: string, text = "", reviewers: string[] = [], channel = approvalChannel("documents/r.docx")): LogEntry => ({ id: `e${n++}`, kind: "comment", channel, parent: "", author: id, name, ts, body: approvalBody(kind, hash, text, people, reviewers), sig: "s" });

describe("approvals on a document", () => {
	it("hashes the words, not the spacing", async () => {
		expect(await hashOf("One  two\nthree")).toBe(await hashOf("One two three"));
		expect(await hashOf("One two")).not.toBe(await hashOf("One too"));
	});

	it("reads only the approval entries of this document", () => {
		const list = approvalsOf([entry("Ana", "A1", 1, "request", "h1", "Please look @Bo", ["Bo"]), entry("Bo", "B1", 2, "approve", "h1", "", [], approvalChannel("other.docx")), { ...entry("Bo", "B1", 3, "approve", "h1"), body: "not json" }], "documents/r.docx", people);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ kind: "request", name: "Ana", reviewers: ["Bo"], text: "Please look @Bo" });
	});

	it("follows each asked person's newest answer, and notices a document that changed since", () => {
		const log = [entry("Ana", "A1", 1, "request", "h1", "", ["Bo", "Cy"]), entry("Bo", "B1", 2, "changes", "h1", "Fix page 2"), entry("Bo", "B1", 3, "approve", "h1"), entry("Cy", "C1", 4, "approve", "h1")];
		const s = statusOf(approvalsOf(log, "documents/r.docx"), "h1");
		expect(s.reviewers.map((r) => [r.name, r.state])).toEqual([["Bo", "approved"], ["Cy", "approved"]]);
		expect(s.approved).toBe(true);
		const later = statusOf(approvalsOf(log, "documents/r.docx"), "h2");
		expect(later.reviewers.every((r) => r.stale)).toBe(true);
		expect(later.approved).toBe(false);
	});

	it("keeps waiting for one who has not answered, and ignores answers from before the request", () => {
		const log = [entry("Bo", "B1", 1, "approve", "h1"), entry("Ana", "A1", 2, "request", "h1", "", ["Bo"])];
		const s = statusOf(approvalsOf(log, "documents/r.docx"), "h1");
		expect(s.reviewers[0].state).toBe("waiting");
	});

	it("lists signatures and says when the text changed after one", () => {
		const s = statusOf(approvalsOf([entry("Ana", "A1", 1, "sign", "h1")], "documents/r.docx"), "h2");
		expect(s.signatures).toHaveLength(1);
		expect(s.signatures[0].stale).toBe(true);
	});
});
