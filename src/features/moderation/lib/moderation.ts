// Moderation as the app shows it: what the backend says is in force (timeouts, bans, kicks to carry out, approvals waiting),
// the words for each act in the moderation log, and who may do what. The rules themselves live in
// src-tauri/src/commands/workspace/moderation.rs; the checks here only decide which buttons to show.

import type { LogEntry } from "@/features/chat/lib/entries";

export interface BannedMember {
	key: string;
	name: string;
	by: string;
	at: number;
	reason: string;
}

export interface TimedOutMember {
	key: string;
	name: string;
	until: number;
	by: string;
	at: number;
	reason: string;
}

// A kick or ban that is waiting: for the Owner's device to carry it out, or for a second person to approve it
export interface PendingAct {
	id: string;
	action: string;
	target: string;
	targetName: string;
	by: string;
	byKey: string;
	at: number;
	reason: string;
}

export interface ModerationState {
	banned: BannedMember[];
	timeouts: TimedOutMember[];
	toRemove: PendingAct[];
	awaiting: PendingAct[];
	requireTwo: boolean;
	deleteApprovedAt: number; // When a second person approved deleting the workspace; 0 for never
}

export interface ModerationView {
	state: ModerationState;
	removed: string[]; // Device keys of the people who were removed, for the Removed badge
	me: string;
	held: number;
}

export const EMPTY_VIEW: ModerationView = { state: { banned: [], timeouts: [], toRemove: [], awaiting: [], requireTwo: false, deleteApprovedAt: 0 }, removed: [], me: "", held: 0 };

export interface ModerationAction {
	action: "timeout" | "untimeout" | "kick" | "ban" | "unban" | "approve" | "policy" | "delete" | "kicked" | "role" | "handoff";
	target?: string;
	targetName?: string;
	until?: number;
	reason?: string;
	of?: string;
	requireTwo?: boolean;
	role?: string;
}

export const MAX_REASON = 200;

// The reason the backend gives a change it keeps for the person to review (held.rs REVIEW_REASON)
export const REVIEW_REASON = "you asked to review changes from others first";

// "12 changes to 4 items from Ana and Bo", for the review banner
export function reviewSummary(items: { record: string; who: string }[]): string {
	if (items.length === 0) return "";
	const records = new Set(items.map((i) => i.record)).size;
	const people = [...new Set(items.map((i) => i.who || "someone"))];
	const from = people.length <= 2 ? people.join(" and ") : `${people[0]}, ${people[1]} and ${people.length - 2} more`;
	return `${items.length} ${items.length === 1 ? "change" : "changes"} to ${records} ${records === 1 ? "item" : "items"} from ${from}`;
}

const MINUTE = 60 * 1000;
export const TIMEOUTS = [
	{ label: "10 minutes", ms: 10 * MINUTE },
	{ label: "1 hour", ms: 60 * MINUTE },
	{ label: "1 day", ms: 24 * 60 * MINUTE },
	{ label: "7 days", ms: 7 * 24 * 60 * MINUTE },
] as const;

export function parseAction(body: string): ModerationAction | null {
	try {
		const a = JSON.parse(body) as ModerationAction;
		return a && typeof a.action === "string" ? a : null;
	} catch {
		return null;
	}
}

// "42 minutes", "3 hours", "2 days": how long until a moment, rounded up
export function timeLeft(until: number, now = Date.now()): string {
	const ms = Math.max(0, until - now);
	const minutes = Math.ceil(ms / MINUTE);
	if (minutes < 60) return `${Math.max(1, minutes)} ${minutes <= 1 ? "minute" : "minutes"}`;
	const hours = Math.ceil(minutes / 60);
	if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
	const days = Math.ceil(hours / 24);
	return `${days} days`;
}

export const durationText = (ms: number): string => TIMEOUTS.find((t) => t.ms === ms)?.label ?? timeLeft(Date.now() + ms);

// Whether the person with this role gets moderation buttons for a member with that role. The backend decides for real: an Admin
// cannot act on an Admin, nobody acts on the Owner, and only the Owner bans.
export function canModerate(selfRole: string, targetRole: string): boolean {
	if (targetRole === "Owner") return false;
	if (selfRole === "Owner") return true;
	return selfRole === "Admin" && targetRole !== "Admin";
}

export const canBan = (selfRole: string) => selfRole === "Owner";

// One line for the moderation log
export function describeAction(e: LogEntry): string | null {
	const a = parseAction(e.body);
	if (!a) return null;
	const who = e.name || "Someone";
	const target = a.targetName || "a member";
	const why = a.reason ? `: ${a.reason}` : "";
	switch (a.action) {
		case "timeout":
			return `${who} timed out ${target} until ${new Date(a.until ?? 0).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}${why}`;
		case "untimeout":
			return `${who} ended the timeout of ${target}`;
		case "kick":
			return `${who} removed ${target}${why}`;
		case "ban":
			return `${who} banned ${target}${why}`;
		case "unban":
			return `${who} lifted the ban on ${target}`;
		case "approve":
			return `${who} approved a request about ${target}`;
		case "policy":
			return a.requireTwo ? `${who} turned on the two-person rule: removing or banning needs a second person` : `${who} turned off the two-person rule`;
		case "delete":
			return `${who} asked to delete the workspace`;
		case "role":
			return `${who} changed the role of ${target} to ${a.role ?? "another role"}`;
		case "handoff":
			return `${who} handed the workspace to ${target}`;
		default:
			// "kicked" only records that the Owner's device carried a removal out
			return null;
	}
}

// The notice a person gets in the inbox when a moderation act is about them
export function noticeText(action: string, by: string, detail: { until?: number; reason?: string }): string {
	const why = detail.reason ? ` Reason: ${detail.reason}` : "";
	switch (action) {
		case "timeout":
			return `${by} timed you out for ${timeLeft(detail.until ?? 0)}. You can read, but your changes wait for an Admin.${why}`;
		case "untimeout":
			return `${by} ended your timeout.`;
		case "kick":
			return `${by} removed you from the workspace. You can come back with a new invite.${why}`;
		case "ban":
			return `${by} banned you from the workspace.${why}`;
		case "unban":
			return `${by} lifted your ban. You can join again with a new invite.`;
		default:
			return `${by} did something about you.`;
	}
}

// The moderation entries of the log, newest first, for the Moderation tab of Insights
export function moderationLog(entries: LogEntry[]): { id: string; at: number; text: string; by: string }[] {
	return entries
		.filter((e) => e.kind === "moderation")
		.map((e) => ({ id: e.id, at: e.ts, text: describeAction(e), by: e.name }))
		.filter((e): e is { id: string; at: number; text: string; by: string } => !!e.text)
		.sort((a, b) => b.at - a.at);
}
