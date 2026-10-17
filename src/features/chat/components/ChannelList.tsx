// The channels down the left of the chat, like Discord's: a # and a name, bold with a count when there is something unread.
// A side panel: the panel colour, a 48px header like the Notes list, and rows whose icons play when the row is hovered.

import { useState } from "react";
import { Plus } from "lucide-react";

import NewChannelDialog from "@/features/chat/components/NewChannelDialog";
import { AnimateIcon, BellOff, Hash } from "@/components/animate-icons";
import Avatar from "@/components/elements/Avatar";
import { Button } from "@/components/ui/button";
import Toolbar from "@/components/layout/Toolbar";
import type { Channel } from "@/features/chat/lib/entries";
import { cn } from "@/lib/utils";

interface ChannelListProps {
	channels: Channel[];
	active: string;
	unread: Record<string, number>;
	muted: Record<string, boolean>;
	canCreate: boolean;
	onSelect: (id: string) => void;
	onCreate: (name: string, topic: string) => Promise<void>;
	// People to write to directly, with the unread count of each conversation; empty where direct messages are not offered
	people?: { key: string; name: string; unread: number }[];
	activeDm?: string | null;
	onSelectDm?: (key: string) => void;
}

const Count = ({ n }: { n: number }) => (
	<span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-2 font-mono text-[13px] font-bold text-white" aria-label={`${n} unread`}>
		{n > 99 ? "99+" : n}
	</span>
);

const row = (isActive: boolean, unread: boolean) =>
	cn(
		"flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors focus-visible:bg-muted",
		isActive ? "bg-primary/10 text-primary" : unread ? "font-semibold text-foreground hover:bg-muted" : "text-muted-foreground hover:bg-muted hover:text-foreground",
	);

export default function ChannelList({ channels, active, unread, muted, canCreate, onSelect, onCreate, people = [], activeDm = null, onSelectDm }: ChannelListProps) {
	const [creating, setCreating] = useState(false);
	const shown = channels.filter((c) => !c.archived || c.id === active);
	return (
		<aside aria-label="Channels" className="flex h-full w-52 shrink-0 flex-col bg-panel @3xl:w-60">
			<Toolbar variant="header" className="justify-between">
				<h2 className="px-1 text-sm font-semibold">Channels</h2>
				{canCreate && (
					<Button variant="ghost" size="icon-sm" aria-label="New channel" onPress={() => setCreating(true)}>
						<Plus className="size-4" />
					</Button>
				)}
			</Toolbar>
			<nav className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-2">
				<ul className="space-y-1">
					{shown.map((c) => {
						const count = unread[c.id] ?? 0;
						const isActive = c.id === active && !activeDm;
						return (
							<li key={c.id}>
								<AnimateIcon animateOnHover asChild>
									<button type="button" onClick={() => onSelect(c.id)} aria-current={isActive ? "page" : undefined} className={row(isActive, count > 0)}>
										<Hash className="size-4 shrink-0" />
										<span className="min-w-0 flex-1 truncate">{c.name}</span>
										{muted[c.id] && <BellOff className="size-3.5 shrink-0 text-muted-foreground" aria-label="Muted" />}
										{count > 0 && !isActive && <Count n={count} />}
									</button>
								</AnimateIcon>
							</li>
						);
					})}
				</ul>
				{people.length > 0 && (
					<>
						<h2 className="px-2 pt-4 pb-1 font-mono text-[13px] text-muted-foreground">Direct Messages</h2>
						<ul className="space-y-1">
							{people.map((p) => (
								<li key={p.key}>
									<button type="button" onClick={() => onSelectDm?.(p.key)} aria-current={activeDm === p.key ? "page" : undefined} className={row(activeDm === p.key, p.unread > 0)}>
										<Avatar name={p.name} className="size-5 text-xs" />
										<span className="min-w-0 flex-1 truncate">{p.name}</span>
										{p.unread > 0 && activeDm !== p.key && <Count n={p.unread} />}
									</button>
								</li>
							))}
						</ul>
					</>
				)}
			</nav>
			{creating && <NewChannelDialog existing={channels.map((c) => c.id)} onClose={() => setCreating(false)} onCreate={onCreate} />}
		</aside>
	);
}
