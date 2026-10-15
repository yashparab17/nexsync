// Writing or editing an announcement: title, Markdown text, level, who it is for, when it shows, when it ends, and when it is
// erased for good.

import { useState } from "react";

import { Megaphone } from "@/components/animate-icons";
import { SectionTitle } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LEVELS, LEVEL_NAMES, MAX_PINNED, type Announcement, type AnnouncementDraft, type Level } from "@/lib/announcements";
import { cn } from "@/lib/utils";

const ROLES = ["Admin", "Editor", "Commenter", "Viewer"] as const;

// "2026-10-16T09:30" in the local time zone, as a datetime-local field wants it
export function toLocalInput(ms: number): string {
	if (!ms) return "";
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (text: string): number => (text ? new Date(text).getTime() || 0 : 0);

interface Props {
	existing?: Announcement; // Set when editing
	people: { name: string; deviceId?: string }[];
	pinnedCount: number; // How many are pinned now, for the limit
	onClose: () => void;
	// `expires` is when it is erased for good, or 0 for never
	onSubmit: (draft: AnnouncementDraft, expires: number) => Promise<void>;
}

export default function AnnouncementDialog({ existing, people, pinnedCount, onClose, onSubmit }: Props) {
	const [title, setTitle] = useState(existing?.title ?? "");
	const [text, setText] = useState(existing?.text ?? "");
	const [level, setLevel] = useState<Level>(existing?.level ?? "info");
	const [scope, setScope] = useState<"everyone" | "chosen">(existing && (existing.audience.roles.length > 0 || existing.audience.members.length > 0) ? "chosen" : "everyone");
	const [roles, setRoles] = useState<string[]>(existing?.audience.roles ?? []);
	const [members, setMembers] = useState<string[]>(existing?.audience.members ?? []);
	const [pinned, setPinned] = useState(existing?.pinned ?? false);
	const [notBefore, setNotBefore] = useState(toLocalInput(existing?.notBefore ?? 0));
	const [ends, setEnds] = useState(toLocalInput(existing?.ends ?? 0));
	const [expires, setExpires] = useState(toLocalInput(existing?.expiresAt ?? 0));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const toggle = (list: string[], set: (v: string[]) => void, value: string) => set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

	const submit = async () => {
		if (!title.trim()) return setError("Give the announcement a title.");
		if (pinned && !existing?.pinned && pinnedCount >= MAX_PINNED) return setError(`Up to ${MAX_PINNED} announcements can be pinned. Unpin one first.`);
		const nb = fromLocalInput(notBefore);
		const end = fromLocalInput(ends);
		const exp = fromLocalInput(expires);
		if (end && nb && end <= nb) return setError("It must end after it first shows.");
		if (exp && exp <= Date.now()) return setError("Pick a time for erasing it that is still to come.");
		setBusy(true);
		try {
			await onSubmit(
				{
					title: title.trim(),
					text,
					level,
					ends: end,
					notBefore: nb,
					pinned,
					system: false,
					audience: scope === "chosen" ? { roles, members } : { roles: [], members: [] },
				},
				exp,
			);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	};

	return (
		<Dialog isOpen onOpenChange={(open) => !open && !busy && onClose()} className="sm:max-w-xl">
			<form
				className="flex max-h-[80vh] min-h-0 flex-col gap-4"
				onSubmit={(e) => {
					e.preventDefault();
					void submit();
				}}
			>
				<DialogHeading icon={<Megaphone className="size-6" />} title={existing ? "Edit Announcement" : "New Announcement"} />
				<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
				<SectionTitle n="01" title="Message" />
				<div className="space-y-1">
					<Label htmlFor="ann-title">Title</Label>
					<Input id="ann-title" autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Release on Friday" />
				</div>
				<div className="space-y-1">
					<Label htmlFor="ann-text">Text (Markdown)</Label>
					<Textarea id="ann-text" value={text} rows={5} maxLength={5000} onChange={(e) => setText(e.target.value)} placeholder="What people need to know" />
				</div>
				<div className="space-y-1">
					<Label>Level</Label>
					<div role="group" aria-label="Level" className="inline-flex">
						{LEVELS.map((l) => (
							<button
								key={l}
								type="button"
								aria-pressed={level === l}
								onClick={() => setLevel(l)}
								className={cn("h-8 cursor-pointer px-4 text-sm font-medium outline-none transition-colors focus-visible:bg-muted", level === l ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}
							>
								{LEVEL_NAMES[l]}
							</button>
						))}
					</div>
					<p className="font-mono text-[13px] text-muted-foreground">{level === "info" ? "Goes to the bell." : level === "important" ? "Stays as a banner until each person says Got it." : "Opens a dialog when the app opens, and a pop-up if it is open now."}</p>
				</div>

				<SectionTitle n="02" title="Who" />
				<div className="space-y-2">
					<div role="group" aria-label="Audience" className="inline-flex">
						{(["everyone", "chosen"] as const).map((s) => (
							<button
								key={s}
								type="button"
								aria-pressed={scope === s}
								onClick={() => setScope(s)}
								className={cn("h-8 cursor-pointer px-4 text-sm font-medium outline-none transition-colors focus-visible:bg-muted", scope === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}
							>
								{s === "everyone" ? "Everyone" : "Chosen People"}
							</button>
						))}
					</div>
					{scope === "chosen" && (
						<div className="space-y-2 bg-muted/40 p-3">
							<p className="font-mono text-[13px] text-muted-foreground">Roles</p>
							<div className="flex flex-wrap gap-4">
								{ROLES.map((r) => (
									<label key={r} className="flex items-center gap-2 text-sm">
										<input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(roles, setRoles, r)} />
										{r}s
									</label>
								))}
							</div>
							<p className="pt-1 font-mono text-[13px] text-muted-foreground">Named people</p>
							<div className="flex flex-wrap gap-4">
								{people
									.filter((p) => p.deviceId)
									.map((p) => (
										<label key={p.deviceId} className="flex items-center gap-2 text-sm">
											<input type="checkbox" checked={members.includes(p.deviceId!)} onChange={() => toggle(members, setMembers, p.deviceId!)} />
											{p.name}
										</label>
									))}
							</div>
							<p className="text-[13px] text-muted-foreground">Everyone's device holds the text; the audience decides who is shown it and asked to say Got it.</p>
						</div>
					)}
				</div>

				<SectionTitle n="03" title="When" />
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="space-y-1">
						<Label htmlFor="ann-from">Shows From</Label>
						<Input id="ann-from" type="datetime-local" value={notBefore} onChange={(e) => setNotBefore(e.target.value)} />
					</div>
					<div className="space-y-1">
						<Label htmlFor="ann-to">Ends</Label>
						<Input id="ann-to" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
					</div>
					<div className="space-y-1 sm:col-span-2">
						<Label htmlFor="ann-erase">Erase for Good At</Label>
						<Input id="ann-erase" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
						<p className="text-[13px] text-muted-foreground">Optional. Every device erases it then, including those that were off. Copies people exported or a changed app can keep it.</p>
					</div>
				</div>
				<label className="flex items-center gap-2 text-sm">
					<input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
					Pin it to the top (up to {MAX_PINNED})
				</label>
				</div>

				{error && (
					<p role="alert" className="bg-destructive/10 p-2 text-sm text-destructive">
						{error}
					</p>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" isDisabled={busy} onPress={onClose}>
						Cancel
					</Button>
					<Button type="submit" isDisabled={busy || !title.trim()}>
						{existing ? "Save Changes" : notBefore ? "Schedule" : "Post"}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
