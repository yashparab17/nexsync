// Header bell: what needs a look. Inside a workspace this is the inbox kept on disk (mentions, replies, and the notices the
// app writes, such as a collaborator joining), so it is still there after a restart; elsewhere it is the session's list.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { plainPreview } from "@/lib/chat/preview";
import { channelLabel, routeForChannel } from "@/lib/chat/routes";
import { noticeText } from "@/lib/moderation";
import { cn } from "@/lib/utils";
import { useChat } from "@/store/chat/ChatContext";
import { useNotifications } from "@/store/notifications/NotificationContext";

const time = (at: number) => {
	const day = new Date(at).toDateString() === new Date().toDateString();
	return day ? new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

function parseDetail(snippet: string): { until?: number; reason?: string } {
	try {
		return JSON.parse(snippet);
	} catch {
		return {};
	}
}

export default function NotificationBell() {
	const session = useNotifications();
	const chat = useChat();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);

	const unread = chat.active ? chat.inboxUnread : session.unread;
	const empty = chat.active ? chat.inbox.length === 0 : session.items.length === 0;

	const toggle = () => {
		// Opening the list is not reading it: an item is read when you open it or choose Mark All Read
		if (!chat.active && !open) session.markAllRead();
		setOpen(!open);
	};

	return (
		<div className="relative">
			<Button variant="ghost" size="icon" onPress={toggle} aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open}>
				<Bell className="size-5" />
				{unread > 0 && (
					<span className="absolute right-1 top-1 flex min-w-4 items-center justify-center bg-primary px-1 text-xs font-bold text-primary-foreground">
						{unread > 9 ? "9+" : unread}
					</span>
				)}
			</Button>
			{open && (
				<>
					<button type="button" aria-label="Close notifications" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
					<div role="region" aria-label="Notifications" className="absolute right-0 z-20 mt-1 w-96 max-w-[90vw] overflow-hidden rounded-lg bg-popover ring-1 ring-foreground/10">
						<div className="flex h-12 items-center justify-between border-b px-4">
							<span className="text-sm font-semibold">Inbox</span>
							<span className="flex items-center gap-3">
								{chat.active && unread > 0 && (
									<button type="button" onClick={() => chat.markInboxRead()} className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground">
										Mark All Read
									</button>
								)}
								{!empty && (
									<button type="button" onClick={chat.active ? chat.clearInbox : session.clear} className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground">
										Clear
									</button>
								)}
							</span>
						</div>
						{empty ? (
							<p className="p-4 text-sm text-muted-foreground">Nothing yet. Mentions, replies, new collaborators and assigned tasks show up here, and stay until you clear them.</p>
						) : chat.active ? (
							<ul className="max-h-96 overflow-y-auto">
								{chat.inbox.map((n) => {
									const entryItem = n.kind === "mention" || n.kind === "reply" || n.kind === "follow" || n.kind === "dm";
									// What an Admin did about this member: the details are in the snippet as JSON
									const detail = n.kind === "moderation" ? parseDetail(n.snippet) : {};
									const go = () => {
										chat.markInboxRead([n.id]);
										if (entryItem && n.channel) {
											setOpen(false);
											navigate(routeForChannel(n.channel));
										}
									};
									return (
										<li key={n.id} className="border-b last:border-b-0">
											<button type="button" onClick={go} className={cn("flex w-full cursor-pointer items-start gap-3 px-4 py-2 text-left hover:bg-muted/60", !n.read && "bg-primary/5")}>
												<span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} aria-hidden />
												<span className="min-w-0 flex-1">
													<span className="block text-sm">
														{entryItem ? (
															<>
																<span className="font-semibold">{n.author}</span> {n.kind === "mention" ? "mentioned you" : n.kind === "reply" ? "replied to you" : n.kind === "dm" ? "sent you a direct message" : "commented"} in <span className="font-semibold">{channelLabel(n.channel)}</span>
															</>
														) : n.kind === "moderation" ? (
															noticeText(n.channel, n.author, detail)
														) : (
															n.snippet
														)}
													</span>
													{entryItem && <span className="block truncate text-[13px] text-muted-foreground">{plainPreview(n.snippet, chat.people)}</span>}
													<span className="block font-mono text-[13px] text-muted-foreground">{time(n.at)}</span>
												</span>
											</button>
										</li>
									);
								})}
							</ul>
						) : (
							<ul className="max-h-96 overflow-y-auto">
								{session.items.map((n) => (
									<li key={n.id} className="border-b px-4 py-2 text-sm last:border-b-0">
										<p>{n.text}</p>
										<p className="font-mono text-[13px] text-muted-foreground">{time(n.at)}</p>
									</li>
								))}
							</ul>
						)}
					</div>
				</>
			)}
		</div>
	);
}
