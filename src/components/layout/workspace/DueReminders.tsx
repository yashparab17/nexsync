// Tells the notification bell about tasks and cards due today or late, without the Tasks or Kanban page being open

import { useEffect } from "react";

import { dueReminders } from "@/lib/reminders";
import { localDay } from "@/lib/planning";
import { myName } from "@/lib/p2p/selfName";
import { getKanban, getTasks } from "@/lib/tauri";
import { useNotifications } from "@/store/notifications/NotificationContext";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

const CHECK_EVERY_MS = 30 * 60 * 1000;

// Each reminder is announced once per day per app session
const announced = new Set<string>();

export default function DueReminders() {
	const { workspace, metadata } = useWorkspace();
	const { dataVersion } = useP2P();
	const { notify } = useNotifications();
	const members = metadata?.members.members;
	const owner = members?.find((m) => m.role === "Owner")?.name;
	const me = members?.find((m) => m.name === myName(workspace?.id, owner))?.id;
	const path = workspace?.path;

	useEffect(() => {
		if (!path || !me) return;
		let live = true;
		const check = async () => {
			const [tasks, columns] = await Promise.all([getTasks(path).catch(() => []), getKanban(path).catch(() => [])]);
			if (!live) return;
			const today = localDay();
			for (const r of dueReminders(tasks, columns, me, today)) {
				const id = `${path}:${today}:${r.key}`;
				if (announced.has(id)) continue;
				announced.add(id);
				notify(r.text);
			}
		};
		void check();
		const timer = setInterval(check, CHECK_EVERY_MS);
		return () => {
			live = false;
			clearInterval(timer);
		};
	}, [path, me, notify, dataVersion]);

	return null;
}
