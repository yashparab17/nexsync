// Who is in the workspace, down the right of the chat: those online first, then the rest, each under their role.

import { Crown } from "@/components/animate-icons";
import Toolbar from "@/components/layout/Toolbar";
import Avatar from "@/components/elements/Avatar";
import type { Member } from "@/types/workspace";
import { cn } from "@/lib/utils";

interface MemberListProps {
	members: Member[];
	online: Set<string>; // Names of the people who are here now
}

export default function MemberList({ members, online }: MemberListProps) {
	const here = members.filter((m) => online.has(m.name));
	const away = members.filter((m) => !online.has(m.name));
	return (
		<aside aria-label="Members" className="hidden h-full w-56 shrink-0 flex-col overflow-y-auto bg-panel lg:flex">
			<Toolbar variant="header">
				<h2 className="px-1 text-sm font-semibold">Members</h2>
			</Toolbar>
			<Group title="Online" list={here} online />
			<Group title="Offline" list={away} online={false} />
		</aside>
	);
}

function Group({ title, list, online }: { title: string; list: Member[]; online: boolean }) {
	if (list.length === 0) return null;
	return (
		<section className="px-2 pb-3">
			<h3 className="px-2 pb-1 font-mono text-[13px] text-muted-foreground">
				{title} / {list.length}
			</h3>
			<ul>
				{list.map((m) => (
					<li key={m.id} className={cn("flex h-10 items-center gap-3 rounded-md px-2 hover:bg-muted", !online && "opacity-60")}>
						<span className="relative shrink-0">
							<Avatar name={m.name} className="size-8" />
							<span className={cn("absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-[var(--panel)]", online ? "bg-success" : "bg-muted-foreground")} aria-hidden />
						</span>
						<span className="min-w-0 flex-1">
							<span className="flex items-center gap-1 truncate text-sm">
								{m.name}
								{m.role === "Owner" && <Crown className="size-3.5 shrink-0 text-warning" aria-label="Owner" />}
							</span>
							{m.role !== "Owner" && <span className="block truncate font-mono text-[13px] text-muted-foreground">{m.role.toLowerCase()}</span>}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}
