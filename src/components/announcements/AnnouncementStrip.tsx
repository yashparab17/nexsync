// The active announcements across the top of the Dashboard: up to three, pinned first, each with its level, title and a way to
// say Got it; the rest are on the Announcements page.

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { AnimateIcon, ArrowUpRight, Check, Megaphone } from "@/components/animate-icons";
import { Button } from "@/components/ui/button";
import { acknowledged, forMe, LEVEL_NAMES, ordered } from "@/lib/announcements";
import { cn } from "@/lib/utils";
import { useChat } from "@/store/chat/ChatContext";
import { useSelfRole } from "@/store/p2p/P2PContext";

const LEVEL_STYLE = { info: "text-info", important: "text-warning", urgent: "text-destructive" } as const;

export default function AnnouncementStrip() {
	const chat = useChat();
	const role = useSelfRole();
	const navigate = useNavigate();
	const list = useMemo(() => ordered(chat.announcements.filter((a) => forMe(a, chat.me, role)), chat.now), [chat.announcements, chat.me, role, chat.now]);
	if (list.length === 0) return null;
	return (
		<section aria-label="Announcements" className="frame bg-muted/40 @xl:col-span-6 @4xl:col-span-12">
			<ul className="divide-y">
				{list.slice(0, 3).map((a) => (
					<li key={a.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
						<span className={cn("flex items-center gap-2 font-mono text-[13px]", LEVEL_STYLE[a.level])}>
							<Megaphone className="size-4" />
							{LEVEL_NAMES[a.level]}
						</span>
						<span className="min-w-0 flex-1 truncate text-sm font-semibold">{a.title}</span>
						{a.author !== chat.me && !acknowledged(a, chat.me) && (
							<Button size="sm" variant="outline" onPress={() => void chat.acknowledge(a.id)}>
								<Check className="size-3.5" />
								Got It
							</Button>
						)}
						<AnimateIcon animateOnHover asChild>
							<button type="button" onClick={() => navigate("/workspace/announcements")} className="flex h-8 cursor-pointer items-center gap-1 font-mono text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
								Read
								<ArrowUpRight className="size-3.5" />
							</button>
						</AnimateIcon>
					</li>
				))}
			</ul>
			{list.length > 3 && <p className="border-t px-4 py-2 font-mono text-[13px] text-muted-foreground">{list.length - 3} more on the Announcements page</p>}
		</section>
	);
}
