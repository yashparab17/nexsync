// Review requests, approvals and signatures on a document. Each is an entry in the workspace's signed log (the log the document's comments
// are in), on a channel of its own, so it carries the signature of the device that wrote it: nobody can approve for somebody else, and the
// record cannot be changed afterwards. Each says which text of the document it was about, as a hash, so a later change shows as "the
// document changed since".

import type { LogEntry } from "@/features/chat/lib/entries";
import { encodeMentions } from "@/features/chat/lib/mentions";
import type { Person } from "@/features/chat/lib/mentions";

export type ApprovalKind = "request" | "approve" | "changes" | "sign";

export interface Approval {
	id: string;
	kind: ApprovalKind;
	// Who wrote it
	name: string;
	deviceId: string;
	ts: number;
	// The text of the document it was about
	hash: string;
	// What the person said
	text: string;
	// For a request: the people asked
	reviewers: string[];
}

export const approvalChannel = (path: string) => `approval:${path}`;

// A short fingerprint of the document's text (the first 16 characters of its SHA-256), enough to tell two texts apart
export async function hashOf(text: string): Promise<string> {
	const bytes = new TextEncoder().encode(text.replace(/\s+/g, " ").trim());
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function approvalBody(kind: ApprovalKind, hash: string, text: string, people: Person[], reviewers: string[] = []): string {
	return JSON.stringify({ text: encodeMentions(text, people), approval: { kind, hash, reviewers } });
}

const KINDS: ApprovalKind[] = ["request", "approve", "changes", "sign"];

export function approvalsOf(entries: LogEntry[], path: string, people: Person[] = []): Approval[] {
	const out: Approval[] = [];
	for (const e of entries) {
		if (e.channel !== approvalChannel(path) || e.kind !== "comment") continue;
		try {
			const body = JSON.parse(e.body) as { text?: unknown; approval?: { kind?: unknown; hash?: unknown; reviewers?: unknown } };
			const a = body.approval;
			if (!a || !KINDS.includes(a.kind as ApprovalKind) || typeof a.hash !== "string") continue;
			const reviewers = Array.isArray(a.reviewers) ? a.reviewers.filter((r): r is string => typeof r === "string").slice(0, 50) : [];
			// The mention markup is shown as the name
			const text = (typeof body.text === "string" ? body.text : "").replace(/<@([A-Za-z0-9]+)>/g, (_m, id: string) => `@${people.find((p) => p.deviceId === id)?.name ?? "someone"}`);
			out.push({ id: e.id, kind: a.kind as ApprovalKind, name: e.name, deviceId: e.author, ts: e.ts, hash: a.hash, text, reviewers });
		} catch {
			// Not one of ours
		}
	}
	return out.sort((x, y) => x.ts - y.ts || x.id.localeCompare(y.id));
}

export interface ReviewerStatus {
	name: string;
	// "waiting", or what the newest answer since the request was
	state: "waiting" | "approved" | "changes";
	answer: Approval | null;
	// The document is not the text the answer was about
	stale: boolean;
}

export interface ApprovalStatus {
	request: Approval | null;
	reviewers: ReviewerStatus[];
	signatures: { signature: Approval; stale: boolean }[];
	// Every person asked has approved the text as it is now
	approved: boolean;
}

export function statusOf(list: Approval[], hash: string): ApprovalStatus {
	const requests = list.filter((a) => a.kind === "request");
	const request = requests[requests.length - 1] ?? null;
	const reviewers: ReviewerStatus[] = (request?.reviewers ?? []).map((name) => {
		const answers = list.filter((a) => (a.kind === "approve" || a.kind === "changes") && a.name.toLowerCase() === name.toLowerCase() && a.ts >= (request?.ts ?? 0));
		const answer = answers[answers.length - 1] ?? null;
		return { name, answer, state: answer ? (answer.kind === "approve" ? "approved" : "changes") : "waiting", stale: !!answer && answer.hash !== hash };
	});
	const signatures = list.filter((a) => a.kind === "sign").map((signature) => ({ signature, stale: signature.hash !== hash }));
	return { request, reviewers, signatures, approved: reviewers.length > 0 && reviewers.every((r) => r.state === "approved" && !r.stale) };
}
