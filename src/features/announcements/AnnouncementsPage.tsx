// Announcements: notices from the Owner and Admins, pinned, with levels and a Got it. Active ones first, then those scheduled
// for later, then an archive of ended and withdrawn ones that the search covers.

import { useMemo, useState } from "react";

import AnnouncementCard from "@/features/announcements/components/AnnouncementCard";
import AnnouncementDialog from "@/features/announcements/components/AnnouncementDialog";
import { Megaphone } from "@/components/animate-icons";
import { EmptyState, Page, PageBody } from "@/components/layout/Page";
import Toolbar, { ToolbarSearch, ToolbarTabs } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import { forMe, MAX_PINNED, ordered, statusOf, type Announcement, type AnnouncementDraft } from "@/features/announcements/lib/announcements";
import { useChat } from "@/store/chat/ChatContext";
import { useSelfRole } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

type Tab = "active" | "scheduled" | "archive";

export default function AnnouncementsPage() {
	const chat = useChat();
	const role = useSelfRole();
	const { metadata } = useWorkspace();
	const [tab, setTab] = useState<Tab>("active");
	const [query, setQuery] = useState("");
	const [dialog, setDialog] = useState<{ existing?: Announcement } | null>(null);
	const canPost = role === "Owner" || role === "Admin";

	// People with their roles, for who an announcement is for and who has said Got it
	const people = useMemo(() => {
		const members = metadata?.members.members ?? [];
		return chat.people.map((p) => ({ ...p, role: members.find((m) => m.name === p.name)?.role }));
	}, [chat.people, metadata]);

	const mine = useMemo(() => chat.announcements.filter((a) => forMe(a, chat.me, role)), [chat.announcements, chat.me, role]);
	const groups = useMemo(() => {
		const active = ordered(mine, chat.now);
		const scheduled = mine.filter((a) => statusOf(a, chat.now) === "scheduled");
		const archive = mine.filter((a) => ["ended", "withdrawn"].includes(statusOf(a, chat.now)));
		return { active, scheduled, archive };
	}, [mine, chat.now]);

	const q = query.trim().toLowerCase();
	const shown = groups[tab].filter((a) => !q || `${a.title} ${a.text} ${a.name}`.toLowerCase().includes(q));
	const pinnedCount = chat.announcements.filter((a) => a.pinned && statusOf(a, chat.now) === "active").length;

	const draftOf = (a: Announcement, over: Partial<AnnouncementDraft> = {}): AnnouncementDraft => ({ title: a.title, text: a.text, level: a.level, ends: a.ends, notBefore: a.notBefore, pinned: a.pinned, system: a.system, audience: a.audience, ...over });

	return (
		<Page>
			<Toolbar>
				<ToolbarSearch placeholder="Search" label="Search announcements" value={query} onChange={setQuery} />
				<ToolbarTabs
					label="Which announcements"
					value={tab}
					onChange={setTab}
					tabs={[
						{ key: "active", label: "Active", count: groups.active.length },
						{ key: "scheduled", label: "Scheduled", count: groups.scheduled.length },
						{ key: "archive", label: "Archive", count: groups.archive.length },
					]}
				/>
				<span className="flex-1" />
				{canPost && (
					<Button size="sm" onPress={() => setDialog({})}>
						<Megaphone className="size-3.5" />
						New Announcement
					</Button>
				)}
			</Toolbar>
			<PageBody>
				{shown.length === 0 ? (
					<EmptyState art="announcements" title={q ? "No Matches" : tab === "active" ? "No Announcements Yet" : tab === "scheduled" ? "Nothing Scheduled" : "The Archive Is Empty"}>
						{tab === "active" ? (canPost ? "Post one to tell everyone something that should not get lost in chat." : "When the Owner or an Admin posts one, it shows here.") : tab === "scheduled" ? "Announcements written for later wait here until their time." : "Ended and withdrawn announcements are kept here."}
					</EmptyState>
				) : (
					<ul className="mx-auto max-w-3xl space-y-4">
						{shown.map((a) => (
							<li key={a.id}>
								<AnnouncementCard a={a} role={role} people={people} onEdit={(x) => setDialog({ existing: x })} onPin={(x, pinned) => void chat.reviseAnnouncement(x.id, draftOf(x, { pinned })).catch(() => {})} />
							</li>
						))}
					</ul>
				)}
			</PageBody>
			{dialog && (
				<AnnouncementDialog
					existing={dialog.existing}
					people={chat.people}
					pinnedCount={Math.min(pinnedCount, MAX_PINNED)}
					onClose={() => setDialog(null)}
					onSubmit={async (draft, expires) => {
						if (dialog.existing) {
							await chat.reviseAnnouncement(dialog.existing.id, draft);
							if (expires !== dialog.existing.expiresAt) await chat.setExpiry("announcement", dialog.existing.id, expires);
							return;
						}
						const posted = await chat.announce(draft);
						if (posted && expires) await chat.setExpiry("announcement", posted, expires);
					}}
				/>
			)}
		</Page>
	);
}
