// Timeout, kick or ban one member, with an optional reason and a plain statement of what each does.

import { useState } from "react";
import { ShieldAlert } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { canBan, MAX_REASON, TIMEOUTS } from "@/features/moderation/lib/moderation";
import { cn } from "@/lib/utils";
import { useChat } from "@/store/chat/ChatContext";
import type { Member } from "@/types/workspace";

type Level = "timeout" | "kick" | "ban";

interface ModerateDialogProps {
	member: Member;
	selfRole: string;
	onClose: () => void;
}

export default function ModerateDialog({ member, selfRole, onClose }: ModerateDialogProps) {
	const chat = useChat();
	const [level, setLevel] = useState<Level>("timeout");
	const [duration, setDuration] = useState<number>(TIMEOUTS[1].ms);
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const isOwner = selfRole === "Owner";
	const needsTwo = chat.moderation.state.requireTwo && level !== "timeout";

	const levels: { id: Level; title: string; text: string }[] = [
		{ id: "timeout", title: "Timeout", text: "Disconnects them for a while. They can read when they come back, but their changes wait for an Admin until it ends. It ends by itself." },
		{ id: "kick", title: "Kick", text: "Removes them now. They can only come back with a new invite." },
		...(canBan(selfRole) ? [{ id: "ban" as const, title: "Ban", text: "Removes them for good. A new invite does not let them back; only you can lift the ban." }] : []),
	];

	const submit = async () => {
		if (!member.deviceId) return;
		setBusy(true);
		setError(null);
		try {
			const base = { target: member.deviceId, targetName: member.name, reason: reason.trim() || undefined };
			if (level === "timeout") await chat.act({ action: "timeout", until: Date.now() + duration, ...base });
			else await chat.act({ action: level, ...base });
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	};

	return (
		<Dialog isOpen onOpenChange={(open) => !open && onClose()} className="sm:max-w-lg">
			<div className="flex flex-col gap-4">
				<DialogHeading icon={<ShieldAlert className="size-6" />} title={`Moderate ${member.name}`} />
				<div role="radiogroup" aria-label="What to do" className="space-y-2">
					{levels.map((l) => (
						<button
							key={l.id}
							type="button"
							role="radio"
							aria-checked={level === l.id}
							onClick={() => setLevel(l.id)}
							className={cn("block w-full cursor-pointer rounded-md px-3 py-2 text-left", level === l.id ? "bg-primary/10 outline outline-1 -outline-offset-1 outline-primary" : "bg-muted/50 hover:bg-muted")}
						>
							<span className="block text-sm font-semibold">{l.title}</span>
							<span className="block text-[13px] text-muted-foreground">{l.text}</span>
						</button>
					))}
				</div>
				{level === "timeout" && (
					<div className="space-y-1">
						<Label htmlFor="timeout-length">For how long</Label>
						<select id="timeout-length" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="h-10 w-full rounded-md bg-input px-3 text-sm outline-none">
							{TIMEOUTS.map((t) => (
								<option key={t.ms} value={t.ms}>
									{t.label}
								</option>
							))}
						</select>
					</div>
				)}
				<div className="space-y-1">
					<Label htmlFor="moderation-reason">Reason (optional)</Label>
					<textarea
						id="moderation-reason"
						value={reason}
						maxLength={MAX_REASON}
						rows={2}
						onChange={(e) => setReason(e.target.value)}
						placeholder="Shown to them and to the Admins"
						className="w-full resize-none rounded-md bg-input p-2 text-sm outline-none placeholder:text-muted-foreground"
					/>
					<p className="text-right font-mono text-[13px] text-muted-foreground">
						{reason.length} / {MAX_REASON}
					</p>
				</div>
				<p className="rounded-md bg-muted/50 p-3 text-[13px] text-muted-foreground">
					What {member.name} wrote and changed stays in the workspace, and is marked as theirs{level === "timeout" ? "" : " with a Removed badge"}. Changes they made before they heard of this wait for an Admin to accept or discard them.
					{needsTwo && " The two-person rule is on, so a second Admin has to approve this first."}
					{!isOwner && level === "kick" && " The Owner's device removes them when it is online."}
				</p>
				{error && (
					<p role="alert" className="bg-destructive/10 p-2 text-sm text-destructive">
						{error}
					</p>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onPress={onClose}>
						Cancel
					</Button>
					<Button variant={level === "timeout" ? "default" : "destructive"} isDisabled={busy || !member.deviceId} onPress={() => void submit()}>
						{needsTwo ? "Ask for Approval" : level === "timeout" ? "Time Out" : level === "kick" ? "Kick" : "Ban"}
					</Button>
				</div>
			</div>
		</Dialog>
	);
}
