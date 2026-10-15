// Every timeout, kick, ban, unban, role change and handover, newest first. Each is a signed entry of the log, so a device that
// only passes entries on cannot invent one.

import { moderationLog } from "@/lib/moderation";
import { useChat } from "@/store/chat/ChatContext";
import { useMemo } from "react";

export default function ModerationLog() {
	const chat = useChat();
	const log = useMemo(() => moderationLog(chat.entries), [chat.entries]);
	if (log.length === 0) {
		return <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing has been moderated. Timeouts, kicks, bans and role changes are listed here, each signed by whoever did it.</p>;
	}
	return (
		<ul className="divide-y divide-border/60" aria-label="Moderation log">
			{log.map((l) => (
				<li key={l.id} className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
					<span className="min-w-0 break-words">{l.text}</span>
					<time className="shrink-0 font-mono text-[13px] text-muted-foreground" dateTime={new Date(l.at).toISOString()}>
						{new Date(l.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
					</time>
				</li>
			))}
		</ul>
	);
}
