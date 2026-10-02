import { useEffect } from "react";

import { useP2P } from "@/store/p2p/P2PContext";

// Tells collaborators which file, card or task this page has open, and that it is closed again when the page lets go of it
export function useReportItem(item: string | null) {
	const { setMyPresence } = useP2P();
	useEffect(() => {
		setMyPresence({ item });
		return () => setMyPresence({ item: null });
	}, [item, setMyPresence]);
}
