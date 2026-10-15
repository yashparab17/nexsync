// The Moderation panel of the Members screen: what waits for a second person, who is banned, and the edits held for review.
// Only the Owner and Admins see it.

import { useMemo, useState } from "react";

import UndoMemberDialog from "@/components/moderation/UndoMemberDialog";
import { parseAction } from "@/lib/moderation";
import type { Member } from "@/types/workspace";

import HeldEdits from "@/components/moderation/HeldEdits";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/layout/Page";
import { timeLeft } from "@/lib/moderation";
import { cn } from "@/lib/utils";
import { useChat } from "@/store/chat/ChatContext";
import { useSelfRole } from "@/store/p2p/P2PContext";

type Tab = "awaiting" | "banned" | "held" | "timeouts" | "removed";

export default function ModerationPanel() {
	const chat = useChat();
	const role = useSelfRole();
	const { state, held } = chat.moderation;
	const [tab, setTab] = useState<Tab>("held");
	const [undoing, setUndoing] = useState<Member | null>(null);
	// Everyone removed, with the name the moderation log gave them when there is one
	const removedPeople = useMemo(() => {
		const names = new Map<string, string>();
		for (const e of chat.entries) {
			const a = e.kind === "moderation" ? parseAction(e.body) : null;
			if (a?.target && a.targetName) names.set(a.target, a.targetName);
		}
		return chat.moderation.removed.map((key) => ({ key, name: names.get(key) ?? `Device ${key.slice(0, 8)}` }));
	}, [chat.entries, chat.moderation.removed]);
	const isOwner = role === "Owner";
	const tabs: { id: Tab; label: string; count: number }[] = [
		{ id: "held", label: "Held Edits", count: held },
		{ id: "awaiting", label: "Awaiting Approval", count: state.awaiting.length },
		{ id: "timeouts", label: "Timed Out", count: state.timeouts.length },
		{ id: "banned", label: "Banned", count: state.banned.length },
		{ id: "removed", label: "Removed", count: removedPeople.length },
	];

	return (
		<Panel
			index="03"
			title="Moderation"
			className="lg:col-span-2"
			right={
				isOwner && (
					<label className="flex cursor-pointer items-center gap-2 text-sm" title="Removing or banning someone needs a second Admin or the Owner to approve it">
						<input
							type="checkbox"
							checked={state.requireTwo}
							onChange={(e) => void chat.act({ action: "policy", requireTwo: e.target.checked })}
							className="size-4 accent-primary"
						/>
						Two-person rule
					</label>
				)
			}
		>
			<div role="tablist" aria-label="Moderation" className="mb-3 flex flex-wrap gap-1">
				{tabs.map((t) => (
					<button
						key={t.id}
						type="button"
						role="tab"
						aria-selected={tab === t.id}
						onClick={() => setTab(t.id)}
						className={cn("flex h-8 cursor-pointer items-center gap-2 rounded-md px-3 text-sm", tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
					>
						{t.label}
						<span className="font-mono text-[13px] tabular-nums opacity-70">{t.count}</span>
					</button>
				))}
			</div>

			{tab === "held" && <HeldEdits />}

			{tab === "awaiting" && (
				<ul className="divide-y divide-border/60">
					{state.awaiting.length === 0 && <li className="px-1 py-6 text-center text-sm text-muted-foreground">{state.requireTwo ? "Nothing is waiting for a second person." : "The two-person rule is off, so a kick or ban takes effect at once."}</li>}
					{state.awaiting.map((p) => (
						<li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
							<div className="min-w-0 text-sm">
								<span className="font-semibold">{p.by}</span> wants to {p.action === "ban" ? "ban" : p.action === "delete" ? "delete the workspace" : "remove"} {p.action !== "delete" && <span className="font-semibold">{p.targetName || "a member"}</span>}
								{p.reason && <span className="text-muted-foreground">: {p.reason}</span>}
								<span className="block text-[13px] text-muted-foreground">Waiting for a second Admin or the Owner.</span>
							</div>
							{p.byKey !== chat.me && (
								<Button size="sm" variant="outline" onPress={() => void chat.act({ action: "approve", of: p.id, target: p.target, targetName: p.targetName })}>
									Approve
								</Button>
							)}
							{p.byKey === chat.me && <span className="font-mono text-[13px] text-muted-foreground">Asked by you</span>}
						</li>
					))}
				</ul>
			)}

			{tab === "timeouts" && (
				<ul className="divide-y divide-border/60">
					{state.timeouts.length === 0 && <li className="px-1 py-6 text-center text-sm text-muted-foreground">Nobody is timed out.</li>}
					{state.timeouts.map((t) => (
						<li key={t.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
							<div className="min-w-0 text-sm">
								<span className="font-semibold">{t.name || "A member"}</span> for {timeLeft(t.until)} more, by {t.by}
								{t.reason && <span className="text-muted-foreground">: {t.reason}</span>}
							</div>
							<Button size="sm" variant="outline" onPress={() => void chat.act({ action: "untimeout", target: t.key, targetName: t.name })}>
								End Timeout
							</Button>
						</li>
					))}
				</ul>
			)}

			{tab === "banned" && (
				<ul className="divide-y divide-border/60">
					{state.banned.length === 0 && <li className="px-1 py-6 text-center text-sm text-muted-foreground">Nobody is banned.</li>}
					{state.banned.map((b) => (
						<li key={b.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
							<div className="min-w-0 text-sm">
								<span className="font-semibold">{b.name || "A member"}</span> banned by {b.by} on {new Date(b.at).toLocaleDateString()}
								{b.reason && <span className="text-muted-foreground">: {b.reason}</span>}
								<span className="block font-mono text-[13px] text-muted-foreground">Device {b.key.slice(0, 8)}</span>
							</div>
							{isOwner ? (
								<Button size="sm" variant="outline" onPress={() => void chat.act({ action: "unban", target: b.key, targetName: b.name })}>
									Unban
								</Button>
							) : (
								<span className="font-mono text-[13px] text-muted-foreground">Only the Owner can unban</span>
							)}
						</li>
					))}
				</ul>
			)}
			{tab === "removed" && (
				<ul className="divide-y divide-border/60">
					{removedPeople.length === 0 && <li className="px-1 py-6 text-center text-sm text-muted-foreground">Nobody has been removed. What a removed person wrote and changed stays, marked with a Removed badge.</li>}
					{removedPeople.map((p) => (
						<li key={p.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
							<div className="min-w-0 text-sm">
								<span className="font-semibold">{p.name}</span>
								<span className="block font-mono text-[13px] text-muted-foreground">Device {p.key.slice(0, 8)}</span>
							</div>
							<Button size="sm" variant="outline" onPress={() => setUndoing({ id: p.key, name: p.name, role: "Viewer", deviceId: p.key })}>
								Undo Their Changes
							</Button>
						</li>
					))}
				</ul>
			)}
			{undoing && <UndoMemberDialog member={undoing} onClose={() => setUndoing(null)} />}
		</Panel>
	);
}
