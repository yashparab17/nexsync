// Chat and Announcements, in the window bar beside the Inbox: an icon each, with the number waiting on it. They were sidebar items, which
// is where the sidebar got crowded, and a floating button covered the corner of pages.

import { Megaphone, MessageSquareText } from "@/components/animate-icons";
import { NavLink } from "react-router-dom";

import { waitingForMe } from "@/features/announcements/lib/announcements";
import { Badge, chosenLook, idleLook } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { useSelfRole } from "@/store/p2p/P2PContext";
import { useChat } from "@/store/chat/ChatContext";

export default function TalkButtons() {
	const { totalUnread, announcements, me, now } = useChat();
	const role = useSelfRole();
	const waiting = waitingForMe(announcements, me, role, now).length;
	const items = [
		{ to: "/workspace/chat", label: "Chat", icon: MessageSquareText, count: totalUnread },
		{ to: "/workspace/announcements", label: "Announcements", icon: Megaphone, count: waiting },
	];
	return (
		<>
			{items.map(({ to, label, icon: Icon, count }) => (
				<NavLink
					key={to}
					to={to}
					aria-label={count > 0 ? `${label}, ${count} new` : label}
					title={label}
					className={({ isActive }) => cn("relative flex size-9 items-center justify-center rounded-md outline-none transition-colors", isActive ? chosenLook : `${idleLook} hover:bg-muted focus-visible:bg-muted`)}
				>
					<Icon className="size-5" aria-hidden />
					<Badge count={count} />
				</NavLink>
			))}
		</>
	);
}
