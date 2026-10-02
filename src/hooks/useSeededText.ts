import { useEffect, useState } from "react";
import type * as Y from "yjs";

import type { CollabDoc } from "@/hooks/useCollabDoc";
import { seedText } from "@/lib/yjs/seed";

// The shared text of a document that is ready for an editor: its Yjs document and what it holds
export interface SeededText {
	doc: Y.Doc;
	text: string;
}

// Fills an empty shared text from the file once, and returns it when an editor can be built.
// The editor has to start with this text in it, because the sync layer only applies later changes.
export function useSeededText(collab: CollabDoc | null, fileText: string | null): SeededText | null {
	const [seeded, setSeeded] = useState<SeededText | null>(null);
	useEffect(() => {
		if (!collab?.synced || fileText === null) return;
		const ytext = collab.doc.getText("content");
		seedText(collab.doc, fileText);
		setSeeded({ doc: collab.doc, text: ytext.toString() });
	}, [collab, fileText]);
	return seeded && collab && seeded.doc === collab.doc ? seeded : null;
}
