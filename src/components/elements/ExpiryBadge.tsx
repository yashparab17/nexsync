// Items that erase themselves: a countdown badge for lists, and the control the Owner and Admins use to set or clear a time.
// An expiry is a signed entry of the log (see announce.rs); every device, including those that were off at the time, erases the
// item when its own clock passes it. The clock is read from each device (RESEARCH.md §8h), so a device set a day ahead erases a
// day early.

import { useMemo, useState } from "react";

import { AnimateIcon, Hourglass } from "@/components/animate-icons";
import { fromLocalInput, toLocalInput } from "@/features/announcements/components/AnnouncementDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { timeUntil } from "@/features/announcements/lib/announcements";
import { useChat } from "@/store/chat/ChatContext";
import { useSelfRole } from "@/store/p2p/P2PContext";

type Entity = "task" | "card" | "file";

// When each item is to be erased, by "task:<id>" and so on, from the newest expiry entry of each
export function useExpiries(): Map<string, number> {
	const { entries } = useChat();
	return useMemo(() => {
		const newest = new Map<string, { ts: number; at: number }>();
		for (const e of entries) {
			if (e.kind !== "expire") continue;
			try {
				const r = JSON.parse(e.body) as { entity?: string; id?: string; at?: number };
				if (!r.entity || !r.id) continue;
				const k = `${r.entity}:${r.id}`;
				const prior = newest.get(k);
				if (!prior || e.ts >= prior.ts) newest.set(k, { ts: e.ts, at: typeof r.at === "number" ? r.at : 0 });
			} catch {
				/* not an expiry */
			}
		}
		return new Map([...newest].filter(([, v]) => v.at > 0).map(([k, v]) => [k, v.at]));
	}, [entries]);
}

export default function ExpiryBadge({ entity, id, expiries }: { entity: Entity; id: string; expiries: Map<string, number> }) {
	const { now } = useChat();
	const at = expiries.get(`${entity}:${id}`);
	if (!at || at <= now) return null;
	return (
		<span title={`Erased for good at ${new Date(at).toLocaleString()}`} className="inline-flex items-center gap-1 font-mono text-[13px] text-warning">
			<Hourglass className="size-3.5" />
			{timeUntil(at, now)}
		</span>
	);
}

// A button for the Owner and Admins that opens a small dialog to set, change or clear the time an item is erased for good
export function ExpiryControl({ entity, id, name }: { entity: Entity; id: string; name: string }) {
	const chat = useChat();
	const role = useSelfRole();
	const expiries = useExpiries();
	const [open, setOpen] = useState(false);
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const at = expiries.get(`${entity}:${id}`) ?? 0;
	if (role !== "Owner" && role !== "Admin") return at > 0 ? <ExpiryBadge entity={entity} id={id} expiries={expiries} /> : null;

	const save = async (next: number) => {
		if (next && next <= Date.now()) return setError("Pick a time that is still to come.");
		try {
			await chat.setExpiry(entity, id, next);
			setOpen(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	return (
		<>
			<AnimateIcon animateOnHover asChild>
				<button
					type="button"
					onClick={() => {
						setValue(toLocalInput(at));
						setError(null);
						setOpen(true);
					}}
					className="flex h-8 cursor-pointer items-center gap-2 font-mono text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
				>
					<Hourglass className="size-3.5" />
					{at > 0 ? `Erased in ${timeUntil(at, chat.now)}` : "Set an Expiry"}
				</button>
			</AnimateIcon>
			{open && (
				<Dialog isOpen onOpenChange={(o) => !o && setOpen(false)} className="sm:max-w-md">
					<div className="flex flex-col gap-4">
						<DialogHeading icon={<Hourglass className="size-6" />} tone="warning" title="Erase for Good" description={`“${name}” will be erased for good from every device when this time comes, including devices that are off now. Copies someone exported, backups of a disk, and a device changed to ignore the notice keep it.`} />
						<div className="space-y-1">
							<Label htmlFor="expiry-at">Erase At</Label>
							<Input id="expiry-at" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
						</div>
						{error && (
							<p role="alert" className="bg-destructive/10 p-2 text-sm text-destructive">
								{error}
							</p>
						)}
						<div className="flex justify-end gap-2">
							{at > 0 && (
								<Button variant="ghost" onPress={() => void save(0)}>
									Clear
								</Button>
							)}
							<Button variant="ghost" onPress={() => setOpen(false)}>
								Cancel
							</Button>
							<Button isDisabled={!value} onPress={() => void save(fromLocalInput(value))}>
								Set Expiry
							</Button>
						</div>
					</div>
				</Dialog>
			)}
		</>
	);
}
