// Where an inbox item or a comment count leads: the chat channel, or the file, task or card the comment thread is on.

import { isThread } from "./entries";

const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);

export function routeForChannel(channel: string): string {
	if (channel === "announcements") return "/workspace/announcements";
	if (!isThread(channel)) return `/workspace/chat?channel=${encodeURIComponent(channel)}`;
	const at = channel.indexOf(":");
	const kind = channel.slice(0, at);
	const target = channel.slice(at + 1);
	if (kind === "doc") return `${isMarkdown(target) ? "/workspace/notes" : "/workspace/editor"}?open=${encodeURIComponent(target)}`;
	if (kind === "task") return `/workspace/tasks?open=${encodeURIComponent(target)}`;
	if (kind === "card") return `/workspace/kanban?open=${encodeURIComponent(target)}`;
	// A change in the catch-up review, a branch or a draft has no page of its own: the dashboard is where they are reached
	if (kind === "announcement") return "/workspace/announcements";
	if (kind === "suggestion") return "/workspace/notes";
	if (kind === "catchup" || kind === "branch" || kind === "draft") return "/workspace";
	return "/workspace/chat";
}

// What to call the place a message or comment was written
export function channelLabel(channel: string): string {
	if (channel === "announcements") return "Announcements";
	if (!isThread(channel)) return `#${channel}`;
	const at = channel.indexOf(":");
	const kind = channel.slice(0, at);
	const target = channel.slice(at + 1);
	if (kind === "doc") return target.split("/").pop() ?? target;
	if (kind === "announcement") return "an announcement";
	if (kind === "suggestion") return "a suggestion";
	if (kind === "catchup") return "a change in catch-up";
	if (kind === "branch") return "a branch";
	if (kind === "draft") return "a draft";
	return kind === "task" ? "a task" : kind === "card" ? "a card" : channel;
}
