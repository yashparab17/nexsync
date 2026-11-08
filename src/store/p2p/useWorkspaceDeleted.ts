// The host deleting the workspace: a guest is told, and the host tells every guest first.

import { useCallback, useState } from "react";

import { p2p } from "@/lib/p2p";

export function useWorkspaceDeleted() {
	const [workspaceDeleted, setWorkspaceDeleted] = useState(false);
	// Tell every guest the workspace is being deleted, then give the message time to arrive
	const announceWorkspaceDeleted = useCallback(async () => {
		await p2p.sendMessage({ kind: "WORKSPACE_DELETED", timestamp: Date.now() }).catch(() => 0);
		await new Promise((resolve) => setTimeout(resolve, 700));
	}, []);
	const dismissWorkspaceDeleted = useCallback(() => setWorkspaceDeleted(false), []);
	const markWorkspaceDeleted = useCallback(() => setWorkspaceDeleted(true), []);
	return { workspaceDeleted, announceWorkspaceDeleted, dismissWorkspaceDeleted, markWorkspaceDeleted };
}
