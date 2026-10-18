import { useEffect, useState } from "react";

import { isIn } from "@/lib/workspaceLayout";
import { useP2P } from "@/store/p2p/P2PContext";

// A number that changes when a collaborator's file lands in one of `folders` (or after a whole-workspace sync), for pages to read their
// folder again then and not on every file that arrives elsewhere (a sync brings thousands)
export function useSyncedIn(...folders: string[]): number {
	const { lastSyncedFile } = useP2P();
	const [version, setVersion] = useState(0);
	const key = folders.join("|");
	useEffect(() => {
		if (!lastSyncedFile) return;
		const path = lastSyncedFile.relPath;
		if (!path || key.split("|").some((f) => isIn(path, f))) setVersion(lastSyncedFile.version);
	}, [lastSyncedFile, key]);
	return version;
}
