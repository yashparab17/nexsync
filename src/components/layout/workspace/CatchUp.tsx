// Header button for the catch-up review: how many changes by other people have not been reviewed, and the review itself

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History } from "lucide-react";

import CatchUpDialog from "@/components/dialogs/workspace/CatchUpDialog";
import { Button } from "@/components/ui/button";
import { countRows, type Lookups } from "@/lib/catchup";
import { getCatchup, getKanban } from "@/lib/tauri";
import { useNotifications } from "@/store/notifications/NotificationContext";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { CatchupEntry, KanbanColumn } from "@/types/workspace";

export default function CatchUp() {
	const { workspace, metadata } = useWorkspace();
	const { dataVersion } = useP2P();
	const { notify } = useNotifications();
	const path = workspace?.path;
	const [entries, setEntries] = useState<CatchupEntry[]>([]);
	const [columns, setColumns] = useState<KanbanColumn[]>([]);
	const [open, setOpen] = useState(false);
	// When this session began, so changes that arrived before it can be told apart from live collaboration
	const sessionStart = useRef(Date.now());
	const announced = useRef(false);

	const refresh = useCallback(async () => {
		if (!path) return;
		try {
			setEntries(await getCatchup(path));
		} catch {
			// The review is optional; a failure to load it must not get in the way of the app
		}
	}, [path]);

	useEffect(() => {
		announced.current = false;
		setEntries([]);
	}, [path]);

	// Reloads when a collaborator's change has just been applied
	useEffect(() => {
		void refresh();
	}, [refresh, dataVersion]);

	// Old changes are marked reviewed by the backend when the list loads, so it loads again now and then
	useEffect(() => {
		const timer = setInterval(() => void refresh(), 10 * 60 * 1000);
		return () => clearInterval(timer);
	}, [refresh]);

	// Said once when a workspace opens, and only about changes made while the app was closed
	useEffect(() => {
		if (announced.current || entries.length === 0) return;
		announced.current = true;
		const away = entries.filter((e) => e.state === "new" && e.at < sessionStart.current && e.path !== "live").length;
		if (away > 0) notify(`${away} ${away === 1 ? "change was" : "changes were"} made by others while you were away. Open Catch up to review.`);
	}, [entries, notify]);

	// Only needed to word the review, so it loads when the review opens
	useEffect(() => {
		if (!open || !path) return;
		getKanban(path)
			.then(setColumns)
			.catch(() => setColumns([]));
	}, [open, path]);

	const members = metadata?.members.members;
	const lookups: Lookups = useMemo(
		() => ({
			member: (id) => members?.find((m) => m.id === id)?.name ?? "a removed member",
			column: (id) => (id === "recovered" ? "Recovered" : (columns.find((c) => c.id === id)?.title ?? "another list")),
		}),
		[members, columns],
	);

	// Counted as the review lists them: a person's edits to one file are one change
	const unread = countRows(
		entries.filter((e) => e.state === "new"),
		members ?? [],
	);
	if (!path) return null;

	return (
		<>
			<Button variant="ghost" size="icon" onPress={() => setOpen(true)} aria-label={unread > 0 ? `Catch up, ${unread} to review` : "Catch up"} className="relative">
				<History className="size-5" />
				{unread > 0 && (
					<span className="absolute right-1 top-1 flex min-w-4 items-center justify-center bg-primary px-1 text-[10px] font-bold text-primary-foreground">{unread > 9 ? "9+" : unread}</span>
				)}
			</Button>
			{open && <CatchUpDialog workspacePath={path} entries={entries} lookups={lookups} members={members ?? []} onChanged={refresh} onClose={() => setOpen(false)} />}
		</>
	);
}
