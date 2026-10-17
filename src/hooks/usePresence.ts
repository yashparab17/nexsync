import { useEffect, useRef } from "react";

import { useP2P } from "@/store/p2p/P2PContext";

// Tells collaborators which line the cursor is on, at most every 700 ms, so someone following lands at the same place. Cleared when
// the page lets go of it.
export function useReportLine(line: number | undefined) {
	const { setMyPresence } = useP2P();
	const last = useRef(0);
	useEffect(() => {
		const wait = Math.max(0, 700 - (Date.now() - last.current));
		const timer = setTimeout(() => {
			last.current = Date.now();
			setMyPresence({ line });
		}, wait);
		return () => clearTimeout(timer);
	}, [line, setMyPresence]);
	useEffect(() => () => setMyPresence({ line: undefined }), [setMyPresence]);
}

// Tells collaborators which file, card or task this page has open, and that it is closed again when the page lets go of it
export function useReportItem(item: string | null) {
	const { setMyPresence } = useP2P();
	useEffect(() => {
		setMyPresence({ item });
		return () => setMyPresence({ item: null });
	}, [item, setMyPresence]);
}
