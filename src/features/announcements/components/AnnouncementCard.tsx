// One announcement: its level, title and text, who it is for, a Got it button, who has acknowledged (for the poster and
// Admins), reactions, a discussion, and the poster's controls.

import { useState } from "react";

import { AnimateIcon, Check, Hourglass, Megaphone, Pencil, Pin, PinOff, Trash2 } from "@/components/animate-icons";
import ReactionBar from "@/features/chat/components/ReactionBar";
import DiscussToggle from "@/components/elements/DiscussToggle";
import MarkdownText from "@/components/elements/MarkdownText";
import { Button } from "@/components/ui/button";
import { acknowledged, audienceText, forMe, inAudience, LEVEL_NAMES, statusOf, timeUntil, type Announcement } from "@/features/announcements/lib/announcements";
import { cn } from "@/lib/utils";
import { useChat } from "@/store/chat/ChatContext";

const when = (ts: number) => new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const LEVEL_STYLE = { info: "bg-info/10 text-info", important: "bg-warning/10 text-warning", urgent: "bg-destructive/10 text-destructive" } as const;

interface Props {
	a: Announcement;
	role: string;
	people: { name: string; deviceId?: string; role?: string }[];
	onEdit: (a: Announcement) => void;
	onPin: (a: Announcement, pinned: boolean) => void;
}

export default function AnnouncementCard({ a, role, people, onEdit, onPin }: Props) {
	const chat = useChat();
	const [busy, setBusy] = useState(false);
	const status = statusOf(a, chat.now);
	const mine = a.author === chat.me;
	const moderator = role === "Owner" || role === "Admin";
	const nameOf = (key: string) => people.find((p) => p.deviceId === key)?.name ?? "someone";
	// Who it is for, apart from whoever wrote it
	const audience = people.filter((p) => p.deviceId && p.deviceId !== a.author && inAudience(a, p.deviceId, p.role ?? "Editor"));
	const acked = new Set(a.acks.map((k) => k.key));
	const waiting = audience.filter((p) => !acked.has(p.deviceId!));

	const run = async (work: () => Promise<void>) => {
		setBusy(true);
		try {
			await work();
		} catch (err) {
			console.error("[announcements]", err);
		} finally {
			setBusy(false);
		}
	};

	return (
		<article aria-label={a.title} className={cn("frame space-y-3 bg-muted/40 p-4", status !== "active" && "opacity-80")}>
			<header className="flex flex-wrap items-center gap-2">
				<span className={cn("flex h-6 items-center gap-1 rounded-md px-2 font-mono text-[13px]", LEVEL_STYLE[a.level])}>
					<Megaphone className="size-3.5" />
					{LEVEL_NAMES[a.level]}
				</span>
				{a.pinned && <Pin className="size-3.5 text-primary" aria-label="Pinned" />}
				{status !== "active" && <span className="rounded-md bg-muted px-2 font-mono text-[13px] text-muted-foreground">{status === "scheduled" ? `Shows ${when(a.notBefore)}` : status === "ended" ? `Ended ${when(a.ends)}` : `Withdrawn by ${a.withdrawnBy || "an Admin"}`}</span>}
				{a.expiresAt > 0 && (
					<span className="flex h-6 items-center gap-1 rounded-md bg-muted px-2 font-mono text-[13px] text-muted-foreground" title={`Erased for good at ${when(a.expiresAt)}`}>
						<Hourglass className="size-3.5" />
						{timeUntil(a.expiresAt, chat.now)}
					</span>
				)}
				<span className="flex-1" />
				{moderator && status !== "withdrawn" && (
					<>
						{(mine || role === "Owner") && (
							<>
								<Button variant="ghost" size="icon-sm" aria-label={a.pinned ? "Unpin" : "Pin"} isDisabled={busy} onPress={() => onPin(a, !a.pinned)} className="text-muted-foreground">
									{a.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
								</Button>
								<Button variant="ghost" size="icon-sm" aria-label="Edit" isDisabled={busy} onPress={() => onEdit(a)} className="text-muted-foreground">
									<Pencil className="size-4" />
								</Button>
							</>
						)}
						<Button variant="ghost" size="icon-sm" aria-label="Withdraw" isDisabled={busy} onPress={() => void run(() => chat.withdrawAnnouncement(a.id))} className="text-muted-foreground hover:text-destructive">
							<Trash2 className="size-4" />
						</Button>
					</>
				)}
			</header>

			<h3 className="text-xl font-semibold">{a.title}</h3>
			{a.text && <MarkdownText text={a.text} />}

			<p className="font-mono text-[13px] text-muted-foreground">
				{a.system ? "Posted by the app" : `Posted by ${a.name}`}, {when(a.ts)}
				{a.edited ? `, updated ${when(a.updatedAt)}` : ""} · For {audienceText(a, nameOf)}
			</p>

			{status !== "withdrawn" && <ReactionBar reactions={a.reactions} me={chat.me} canReact={chat.canPost} onReact={(emoji) => chat.toggleReaction("announcements", a.id, emoji, a.reactions)} />}

			{status === "active" && !mine && !acknowledged(a, chat.me) && forMe(a, chat.me, role) && (
				<Button size="sm" isDisabled={busy} onPress={() => void run(() => chat.acknowledge(a.id))}>
					<Check className="size-3.5" />
					Got It
				</Button>
			)}
			{acknowledged(a, chat.me) && !mine && (
				<p className="flex items-center gap-1 font-mono text-[13px] text-success">
					<Check className="size-3.5" /> You said Got it
				</p>
			)}

			{(mine || moderator) && audience.length > 0 && (
				<AnimateIcon animateOnHover asChild>
					<details className="text-sm">
						<summary className="flex h-8 cursor-pointer items-center gap-2 font-mono text-[13px] text-muted-foreground outline-none hover:text-foreground">
							<Check className="size-3.5" />
							Got it from {audience.length - waiting.length} of {audience.length}, as far as this device has heard
						</summary>
						<ul className="mt-1 space-y-1">
							{a.acks
								.filter((k) => audience.some((p) => p.deviceId === k.key))
								.map((k) => (
									<li key={k.key} className="flex justify-between gap-4">
										<span>{nameOf(k.key)}</span>
										<span className="font-mono text-[13px] text-muted-foreground">{when(k.ts)}</span>
									</li>
								))}
							{waiting.map((p) => (
								<li key={p.deviceId} className="flex justify-between gap-4 text-muted-foreground">
									<span>{p.name}</span>
									<span className="font-mono text-[13px]">Not yet</span>
								</li>
							))}
						</ul>
						<p className="mt-2 text-[13px] text-muted-foreground">Counted per device, not per person. An answer from someone who was offline arrives when they next link to a device that is linked to this one.</p>
					</details>
				</AnimateIcon>
			)}

			{status !== "withdrawn" && <DiscussToggle channel={`announcement:${a.id}`} canComment={chat.canPost} />}
		</article>
	);
}
