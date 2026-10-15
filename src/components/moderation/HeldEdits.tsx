// Edits to tasks and cards that were made by a device that may not write now, kept apart for an Owner or Admin to accept or
// discard (see src-tauri/src/commands/workspace/held.rs).

import { useCallback, useEffect, useState } from "react";
import { Check, X } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { fieldName } from "@/components/elements/ConflictPanel";
import { heldAccept, heldDiscard, heldList, type HeldWrite } from "@/lib/tauri";
import { REVIEW_REASON } from "@/lib/moderation";
import { useChat } from "@/store/chat/ChatContext";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

const shown = (value: string) => {
	try {
		const v = JSON.parse(value);
		const text = typeof v === "string" ? v : JSON.stringify(v);
		return text.length > 120 ? `${text.slice(0, 119)}…` : text || "(empty)";
	} catch {
		return value;
	}
};

export default function HeldEdits({ onlyReview = false }: { onlyReview?: boolean }) {
	const { workspace } = useWorkspace();
	const { refreshData } = useP2P();
	const chat = useChat();
	const path = workspace?.path;
	const [items, setItems] = useState<HeldWrite[]>([]);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!path) return;
		try {
			setItems(((await heldList(path)) ?? []).filter((h) => !onlyReview || h.reason === REVIEW_REASON));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [path, onlyReview]);

	// Held writes arrive with merges, which the app hears about as a change in the count
	useEffect(() => {
		void load();
	}, [load, chat.moderation.held]);

	const run = async (work: () => Promise<void>) => {
		setError(null);
		try {
			await work();
			await load();
			refreshData();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	if (items.length === 0 && !error) {
		return <p className="px-1 py-6 text-center text-sm text-muted-foreground">Nothing is held. Changes from a removed, timed-out or unknown device would wait here for you to accept or discard them.</p>;
	}
	return (
		<div className="space-y-2">
			{error && (
				<p role="alert" className="bg-destructive/10 p-2 text-sm text-destructive">
					{error}
				</p>
			)}
			<ul className="divide-y divide-border/60">
				{items.map((h) => (
					<li key={h.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
						<div className="min-w-0">
							<p className="text-sm">
								<span className="font-semibold">{h.who || "Unknown"}</span> changed the {fieldName(h.path).toLowerCase()} of {h.entity === "task" ? "task" : "card"} <span className="font-semibold">{h.title ? `“${h.title}”` : "a record this device does not have"}</span>
							</p>
							<p className="break-words font-mono text-[13px] text-muted-foreground">{shown(h.value)}</p>
							<p className="text-[13px] text-muted-foreground">
								Held because {h.reason}. Written {new Date(h.ts).toLocaleString()}. Device {h.by.slice(0, 8) || "unknown"}.
							</p>
						</div>
						<div className="flex shrink-0 gap-2">
							<Button size="sm" variant="outline" onPress={() => void run(() => heldAccept(path!, h.id))}>
								<Check className="size-3.5" />
								Accept
							</Button>
							<Button size="sm" variant="ghost" onPress={() => void run(() => heldDiscard(path!, h.id))}>
								<X className="size-3.5" />
								Discard
							</Button>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
