// "12 changes from others are waiting": shown across the top while this device keeps other people's changes to tasks and
// cards apart until the person has looked (Settings, Review changes before they apply). Accept or skip each, or all at once.

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck } from "@/components/animate-icons";

import HeldEdits from "@/components/moderation/HeldEdits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
import { REVIEW_REASON, reviewSummary } from "@/lib/moderation";
import { heldAccept, heldDiscard, heldList, type HeldWrite } from "@/lib/tauri";
import { useChat } from "@/store/chat/ChatContext";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

export default function ReviewBanner() {
	const { workspace } = useWorkspace();
	const { refreshData } = useP2P();
	const chat = useChat();
	const path = workspace?.path;
	const [items, setItems] = useState<HeldWrite[]>([]);
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		if (!path) return;
		try {
			setItems(((await heldList(path)) ?? []).filter((h) => h.reason === REVIEW_REASON));
		} catch {
			/* the banner is only a convenience */
		}
	}, [path]);
	useEffect(() => {
		void load();
	}, [load, chat.moderation.held]);

	const all = async (fn: (path: string, id: number) => Promise<void>) => {
		if (!path) return;
		setBusy(true);
		try {
			for (const h of items) await fn(path, h.id);
		} finally {
			setBusy(false);
			await load();
			refreshData();
			setOpen(false);
		}
	};

	if (items.length === 0) return null;
	return (
		<>
			<div role="status" className="flex shrink-0 flex-wrap items-center gap-3 bg-info/10 px-4 py-2 text-sm text-info">
				<span className="min-w-0 flex-1">{reviewSummary(items)} {items.length === 1 ? "is" : "are"} waiting for you.</span>
				<Button size="sm" variant="outline" onPress={() => setOpen(true)}>
					Review
				</Button>
			</div>
			{open && (
				<Dialog isOpen onOpenChange={(o) => !o && (setOpen(false), void load())} className="sm:max-w-2xl">
					<div className="flex max-h-[75vh] min-h-0 flex-col gap-3">
						<DialogHeading icon={<ClipboardCheck className="size-6" />} title="Review Changes" description={`${reviewSummary(items)}. Nothing is applied until you accept it.`} />
						<div className="flex gap-2">
							<Button size="sm" isDisabled={busy} onPress={() => void all(heldAccept)}>
								Accept All
							</Button>
							<Button size="sm" variant="outline" isDisabled={busy} onPress={() => void all(heldDiscard)}>
								Skip All
							</Button>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto">
							<HeldEdits onlyReview />
						</div>
					</div>
				</Dialog>
			)}
		</>
	);
}
