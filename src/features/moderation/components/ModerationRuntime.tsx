// Two small jobs that belong to the whole workspace window: carrying out removals on the Owner's device, and telling a member
// that they are timed out.

import { useEffect, useRef } from "react";

import { systemNotice } from "@/features/announcements/lib/announcements";
import { timeLeft } from "@/features/moderation/lib/moderation";
import { writeWorkspaceMetadata } from "@/lib/tauri";
import { useChat } from "@/store/chat/ChatContext";
import { useNotifications } from "@/store/notifications/NotificationContext";
import { useP2P, useSelfRole } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// A kick or a ban is a signed entry anyone allowed to moderate can write, but the member list is signed only by the Owner's
// device, so that device takes the person off the list when it sees the entry, and notes that it did (the "kicked" entry).
export function ModerationExecutor() {
	const chat = useChat();
	const role = useSelfRole();
	const { workspace, metadata, refreshMetadata, addActivityEvent } = useWorkspace();
	const { blockDevice, disconnectPeer } = useP2P();
	const handled = useRef(new Set<string>());
	const running = useRef(false);
	const todo = chat.moderation.state.toRemove;

	useEffect(() => {
		if (role !== "Owner" || !workspace?.path || !metadata || running.current) return;
		const fresh = todo.filter((p) => !handled.current.has(p.id));
		if (fresh.length === 0) return;
		running.current = true;
		const path = workspace.path;
		void (async () => {
			let members = metadata.members.members;
			try {
				for (const p of fresh) {
					handled.current.add(p.id);
					const member = members.find((m) => m.deviceId === p.target);
					if (member) {
						members = members.filter((m) => m.id !== member.id);
						await writeWorkspaceMetadata({ path, metadata: { ...metadata, members: { members } } });
						await addActivityEvent("Removed member", `${member.name} was ${p.action === "ban" ? "banned" : "removed"} by ${p.by}${p.reason ? `: ${p.reason}` : ""}`, undefined, "member");
					}
						// Removals are not announced unless the Owner turned that on (Settings)
						try {
							if (localStorage.getItem(`nexsync-announce-removals:${workspace.id}`) === "1" && member) await chat.announce(systemNotice(`${member.name} is no longer a member`));
						} catch {
							/* blocked storage: nothing is announced */
						}
						await blockDevice(p.target).catch(() => disconnectPeer(p.target).catch(() => {}));
					await chat.act({ action: "kicked", target: p.target, targetName: p.targetName, of: p.id });
				}
				await refreshMetadata();
			} catch (err) {
				console.error("[moderation] Could not carry out a removal:", err);
			} finally {
				running.current = false;
			}
		})();
	}, [role, workspace?.path, metadata, todo, chat, blockDevice, disconnectPeer, addActivityEvent, refreshMetadata]);

	return null;
}

// A device joins under the name of someone who was banned. A key identifies a device, not a person, so this cannot be stopped;
// the Owner and Admins are told, and the notice says so.
export function RejoinWatch() {
	const { moderation } = useChat();
	const role = useSelfRole();
	const { peers } = useP2P();
	const { notify } = useNotifications();
	const told = useRef(new Set<string>());
	useEffect(() => {
		if (role !== "Owner" && role !== "Admin") return;
		for (const p of peers) {
			if (p.isHost || told.current.has(p.id)) continue;
			const same = moderation.state.banned.find((b) => b.key !== p.id && b.name && b.name.trim().toLowerCase() === p.name.trim().toLowerCase());
			if (!same) continue;
			told.current.add(p.id);
			notify(`${p.name} just joined, with the same name as ${same.name}, who was banned. A device key identifies a device, not a person, so this may be someone else, or the same person on a new device.`);
		}
	}, [peers, moderation, role, notify]);
	return null;
}

// Shown across the top while this device is timed out
export function TimeoutBanner() {
	const { timedOut } = useChat();
	if (!timedOut) return null;
	return (
		<div role="status" className="flex shrink-0 items-start gap-3 bg-warning/10 px-4 py-2 text-sm text-warning">
			<span className="min-w-0 flex-1">
				You are timed out for about {timeLeft(timedOut.until)} more, by {timedOut.by}.{timedOut.reason ? ` Reason: ${timedOut.reason}.` : ""} You can read, but chat and comments are off, and your changes to tasks and cards wait for an Admin.
			</span>
		</div>
	);
}
