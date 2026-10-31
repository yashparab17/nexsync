// Header bell: what needs a look. Inside a workspace this is the inbox kept on disk (mentions, replies, and the notices the
// app writes, such as a collaborator joining), so it is still there after a restart; elsewhere it is the session's list.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { History, Bell } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { plainPreview } from "@/features/chat/lib/preview";
import { channelLabel, routeForChannel } from "@/features/chat/lib/routes";
import { noticeText } from "@/features/moderation/lib/moderation";
import Art from "@/components/elements/Art";
import { cn } from "@/lib/utils";
import { useChat } from "@/store/chat/ChatContext";
import { useNotifications } from "@/store/notifications/NotificationContext";
import { readPopupsMuted, savePopupsMuted } from "@/lib/popupPrefs";
import BarBadge from "@/features/shell/components/BarBadge";
import { useCatchUp } from "@/features/shell/components/CatchUp";
import { readQuiet, saveQuiet } from "@/lib/p2p/presence";

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
	const [muted, setMuted] = useState(readPopupsMuted);
	const [quiet, setQuiet] = useState(readQuiet);

	const review = useCatchUp();
	const unread = (chat.active ? chat.inboxUnread : session.unread) + review.unread;
	const empty = (chat.active ? chat.inbox.length === 0 : session.items.length === 0) && review.unread === 0;

	const toggle = () => {
		// Opening the list is not reading it: an item is read when you open it or choose Mark All Read
		if (!chat.active && !open) session.markAllRead();
		setOpen(!open);
	};

	return (
		<div className="relative">
			<Button variant="ghost" size="icon-sm" onPress={toggle} aria-label={unread > 0 ? `Inbox, ${unread} new` : "Inbox"} aria-expanded={open} className="relative">
				<Bell className="size-4" />
				<BarBadge count={unread} />
			</Button>
			{review.review}
			{open && (
				<>
					<button type="button" aria-label="Close notifications" className="fixed inset-0 z-[65] cursor-default" onClick={() => setOpen(false)} />
					<div role="region" aria-label="Notifications" className="absolute right-0 z-[66] mt-1 w-96 max-w-[90vw] overflow-hidden rounded-lg bg-popover ring-1 ring-foreground/10">
						<div className="flex h-12 items-center justify-between border-b px-4">
							<span className="text-sm font-semibold">Inbox</span>
							<span className="flex items-center gap-3">
								<button
									type="button"
									aria-pressed={muted}
									title="Notices still arrive here; only the pop-ups stop"
									onClick={() => {
										savePopupsMuted(!muted);
										setMuted(!muted);
									}}
									className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground"
								>
									{muted ? "Unmute Pop-ups" : "Mute Pop-ups"}
								</button>
								<button
									type="button"
									aria-pressed={quiet}
									title="Whether a notice shows when someone joins or leaves"
									onClick={() => {
										saveQuiet(!quiet);
										setQuiet(!quiet);
									}}
									className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground"
								>
									{quiet ? "Show Joins" : "Hide Joins"}
								</button>
								{chat.active && chat.inboxUnread > 0 && (
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
						{review.unread > 0 && (
							<button
								type="button"
								onClick={() => {
									setOpen(false);
									review.openReview();
								}}
								className="flex w-full cursor-pointer items-center gap-3 border-b bg-primary/5 px-4 py-3 text-left text-sm hover:bg-muted/60"
							>
								<History className="size-4 shrink-0 text-primary" aria-hidden />
								<span className="min-w-0 flex-1">
									{review.unread} {review.unread === 1 ? "change" : "changes"} by others to review
								</span>
								<span className="text-[13px] text-muted-foreground">Catch up</span>
							</button>
						)}
						{empty ? (
							<div className="flex flex-col items-center gap-3 p-6 text-center">
								<Art name="caught-up" className="h-28 w-40" />
								<p className="text-sm text-muted-foreground">Nothing yet. Mentions, replies, new people and assigned tasks appear here.</p>
								<button type="button" onClick={() => { setOpen(false); review.openReview(); }} className="cursor-pointer text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Look back at changes by others</button>
							</div>
						) : chat.active ? (
							<ul className="max-h-96 overflow-y-auto">
								{chat.inbox.map((n) => {
									const entryItem = n.kind === "mention" || n.kind === "reply" || n.kind === "follow" || n.kind === "dm" || n.kind === "announcement";
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
																<span className="font-semibold">{n.author}</span> {n.kind === "mention" ? "mentioned you" : n.kind === "reply" ? "replied to you" : n.kind === "dm" ? "sent you a direct message" : n.kind === "announcement" ? "posted" : "commented"} in <span className="font-semibold">{channelLabel(n.channel)}</span>
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
