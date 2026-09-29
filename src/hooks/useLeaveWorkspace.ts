import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { p2p } from "@/lib/p2p";
import { deleteWorkspace, removeRecentWorkspace } from "@/lib/tauri";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P } from "@/store/p2p/P2PContext";
import type { DeleteOutcome } from "@/types/workspace";

// Closes the open workspace for good: drops collaborators, optionally sends its files to the
// recycle bin, forgets it in the recent list and returns to the Welcome page.
export function useLeaveWorkspace() {
	const { workspace, clearWorkspace } = useWorkspace();
	const { disconnectAll } = useP2P();
	const navigate = useNavigate();

	return useCallback(
		async ({ deleteFiles }: { deleteFiles: boolean }): Promise<DeleteOutcome | null> => {
			if (!workspace) return null;
			const { id, path } = workspace;

			await disconnectAll().catch(() => {});
			// Stop watching the folder first; an open watcher can block moving it on Windows.
			await p2p.setSharedWorkspace(null).catch(() => {});

			// Delete before closing so a failure leaves the workspace open and untouched.
			const outcome = deleteFiles ? await deleteWorkspace(path) : null;
			// Closing saves the workspace (and re-adds it to recents), which a deleted folder cannot do.
			await clearWorkspace({ save: !deleteFiles });
			await removeRecentWorkspace(id);
			navigate("/");
			return outcome;
		},
		[workspace, clearWorkspace, disconnectAll, navigate],
	);
}
