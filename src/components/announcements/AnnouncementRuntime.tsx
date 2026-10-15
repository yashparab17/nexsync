// What announcements do across the whole workspace window, whichever page is open:
// - Info goes to the bell (every level does, once, when it shows);
// - Important stays as a banner across the top until the person has said Got it;
// - Urgent opens a dialog the next time the app opens, and a pop-up if it arrives while the app is open.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import MarkdownText from "@/components/elements/MarkdownText";
import { Check, Megaphone } from "@/components/animate-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
import { forMe, statusOf, waitingForMe } from "@/lib/announcements";
import { expirySweep, inboxAdd } from "@/lib/tauri";
import { useChat } from "@/store/chat/ChatContext";
import { useNotifications } from "@/store/notifications/NotificationContext";
import { useP2P, useSelfRole } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

const read = (key: string): string[] => {
	try {
		return JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
	} catch {
		return [];
	}
};

export default function AnnouncementRuntime() {
	const chat = useChat();
	const role = useSelfRole();
	const { workspace } = useWorkspace();
	const { notify } = useNotifications();
	const navigate = useNavigate();
	const { refreshData } = useP2P();
	const path = workspace?.path;
	const key = `nexsync-announced:${workspace?.id ?? ""}`;
	const [dialogFor, setDialogFor] = useState<string | null>(null);
	const shownDialog = useRef(new Set<string>());
	const baseline = useRef<Set<string> | null>(null);

	const mine = useMemo(() => chat.announcements.filter((a) => forMe(a, chat.me, role) && a.author !== chat.me), [chat.announcements, chat.me, role]);
	const waiting = useMemo(() => waitingForMe(chat.announcements, chat.me, role, chat.now), [chat.announcements, chat.me, role, chat.now]);

	// Whatever an expiry says is due is erased for good, when the window opens and then every minute; the entries stay, so a copy
	// that arrives later from a device that was off is erased or refused in turn
	const expiryCount = chat.entries.filter((e) => e.kind === "expire").length;
	useEffect(() => {
		if (!path) return;
		let live = true;
		const run = () =>
			expirySweep(path)
				.then((n) => live && n > 0 && refreshData())
				.catch(() => {});
		void run();
		const timer = setInterval(run, 60_000);
		return () => {
			live = false;
			clearInterval(timer);
		};
	}, [path, expiryCount, refreshData]);

	// To the bell, once each, when it shows
	useEffect(() => {
		if (!path || !chat.me) return;
		const told = new Set(read(key));
		const fresh = mine.filter((a) => statusOf(a, chat.now) === "active" && !told.has(a.id));
		if (fresh.length === 0) return;
		for (const a of fresh) {
			told.add(a.id);
			void inboxAdd(path, "announcement", a.id, a.title, "announcements", a.name).catch(() => {});
		}
		try {
			localStorage.setItem(key, JSON.stringify([...told].slice(-300)));
		} catch {
			/* blocked storage: the bell may repeat itself after a restart */
		}
	}, [mine, chat.now, chat.me, path, key]);

	// Urgent: a dialog for each that was already waiting when the app opened, a pop-up for each that arrives after
	useEffect(() => {
		if (!chat.me) return;
		const urgent = waiting.filter((a) => a.level === "urgent");
		if (baseline.current === null) {
			if (chat.entries.length === 0) return; // Not loaded yet
			baseline.current = new Set(urgent.map((a) => a.id));
			const first = urgent.find((a) => !shownDialog.current.has(a.id));
			if (first) {
				shownDialog.current.add(first.id);
				setDialogFor(first.id);
			}
			return;
		}
		for (const a of urgent) {
			if (baseline.current.has(a.id)) continue;
			baseline.current.add(a.id);
			notify(`Urgent: ${a.title}`);
		}
	}, [waiting, chat.me, chat.entries.length, notify]);

	const important = waiting.filter((a) => a.level === "important" || a.level === "urgent");
	const urgentOpen = dialogFor ? chat.announcements.find((a) => a.id === dialogFor) : undefined;

	return (
		<>
			{important.length > 0 && (
				<div role="status" className="flex shrink-0 flex-wrap items-center gap-4 bg-warning/10 px-4 py-2 text-sm text-warning">
					<Megaphone className="size-4 shrink-0" />
					<span className="min-w-0 flex-1 truncate">
						<span className="font-semibold">{important[0].title}</span>
						{important.length > 1 && <span className="font-mono text-[13px]"> and {important.length - 1} more</span>}
					</span>
					<Button size="sm" variant="outline" onPress={() => navigate("/workspace/announcements")}>
						Read
					</Button>
					<Button size="sm" onPress={() => void chat.acknowledge(important[0].id)}>
						<Check className="size-3.5" />
						Got It
					</Button>
				</div>
			)}
			{urgentOpen && (
				<Dialog isOpen onOpenChange={(open) => !open && setDialogFor(null)} className="sm:max-w-lg">
					<div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto">
						<DialogHeading icon={<Megaphone className="size-6" />} tone="danger" title={urgentOpen.title} description={`Urgent, from ${urgentOpen.name}`} />
						{urgentOpen.text && <MarkdownText text={urgentOpen.text} />}
						<div className="flex justify-end gap-2">
							<Button variant="ghost" onPress={() => setDialogFor(null)}>
								Later
							</Button>
							<Button
								onPress={() => {
									void chat.acknowledge(urgentOpen.id);
									setDialogFor(null);
								}}
							>
								<Check className="size-3.5" />
								Got It
							</Button>
						</div>
					</div>
				</Dialog>
			)}
		</>
	);
}
