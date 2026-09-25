import { useEffect, useState } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { SqlitePersistenceProvider } from "@/lib/yjs";
import { useP2P } from "@/store/p2p/P2PContext";

export interface CollabDoc {
	doc: Y.Doc;
	awareness: Awareness;
	synced: boolean;
}

// Binds a workspace file to a live, P2P-synced, SQLite-persisted Yjs document.
// Returns null until a workspace path and doc id are available.
export function useCollabDoc(
	workspacePath: string | undefined,
	docId: string | undefined,
): CollabDoc | null {
	const { createSyncProvider } = useP2P();
	const [state, setState] = useState<{ doc: Y.Doc; awareness: Awareness } | null>(null);
	const [synced, setSynced] = useState(false);

	useEffect(() => {
		if (!workspacePath || !docId) {
			setState(null);
			setSynced(false);
			return;
		}

		const doc = new Y.Doc();
		const awareness = new Awareness(doc);
		const persistence = new SqlitePersistenceProvider(workspacePath, docId, doc);
		const syncProvider = createSyncProvider(doc, docId, awareness);

		setSynced(false);
		setState({ doc, awareness });
		const offSynced = persistence.onSynced(() => setSynced(true));

		return () => {
			offSynced();
			// Broadcasts our own removal first, while the provider is still listening, so peers
			// see the cursor disappear immediately instead of waiting for the 30s stale timeout
			awareness.destroy();
			syncProvider.destroy();
			void persistence.destroy();
			doc.destroy();
		};
	}, [workspacePath, docId, createSyncProvider]);

	return state ? { doc: state.doc, awareness: state.awareness, synced } : null;
}
