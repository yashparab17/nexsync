// Notices, after other people's changes arrive, that a task or card was given to this person or changed while they follow it.
// What was seen at the last check is kept on this device.

import { useEffect, useRef } from "react";

import { followEvents, snapshotOf, type Snapshot } from "@/lib/follow";
import { myName } from "@/lib/p2p/selfName";
import { getKanban, getTasks } from "@/lib/tauri";
import { useChat } from "@/store/chat/ChatContext";
import { useNotifications } from "@/store/notifications/NotificationContext";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

export default function FollowWatch() {
	const { workspace, metadata } = useWorkspace();
	const { dataVersion } = useP2P();
	const { notify } = useNotifications();
	const chat = useChat();
	const members = metadata?.members.members;
	const owner = members?.find((m) => m.role === "Owner")?.name;
	const me = members?.find((m) => m.name === myName(workspace?.id, owner))?.id ?? "";
	const path = workspace?.path;
	const key = `nexsync-snap:${workspace?.id ?? ""}`;
	// The follow list changes often; the check reads the latest through a ref and does not run again for it
	const follows = useRef(chat.follows);
	follows.current = chat.follows;
	const follow = useRef(chat.follow);
	follow.current = chat.follow;

	useEffect(() => {
		if (!path || !me) return;
		let live = true;
		void (async () => {
			const [tasks, columns] = await Promise.all([getTasks(path).catch(() => []), getKanban(path).catch(() => [])]);
			if (!live) return;
			const now = snapshotOf(tasks, columns);
			let before: Snapshot | null = null;
			try {
				const raw = localStorage.getItem(key);
				before = raw ? (JSON.parse(raw) as Snapshot) : null;
			} catch {
				before = null;
			}
			for (const e of followEvents(before, now, me, follows.current)) {
				notify(e.text);
				if (e.follow) follow.current(e.key, true);
			}
			try {
				localStorage.setItem(key, JSON.stringify(now));
			} catch {
				/* blocked storage: the next check announces nothing, which is the safe side */
			}
		})();
		return () => {
			live = false;
		};
	}, [path, me, key, notify, dataVersion]);

	return null;
}
