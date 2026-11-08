// The files being downloaded from peers, and cancelling them.

import { useCallback, useEffect, useRef, useState } from "react";

import { p2p } from "@/lib/p2p";

// A file being downloaded from a peer
export interface FileTransfer {
	peerId: string;
	relPath: string;
	receivedBytes: number;
	totalBytes: number;
}

export function useTransfers() {
	const [transfers, setTransfers] = useState<FileTransfer[]>([]);
	// Set when the user cancels everything, so a snapshot download loop stops instead of starting the next file
	const cancelledRef = useRef(false);
	useEffect(() => {
		const offProgress = p2p.onFileProgress((event) =>
			setTransfers((prev) => [
				...prev.filter((t) => !(t.peerId === event.peerId && t.relPath === event.relPath)),
				{ peerId: event.peerId, relPath: event.relPath, receivedBytes: event.receivedBytes, totalBytes: event.totalBytes },
			]),
		);
		const offEnded = p2p.onFileEnded((event) => setTransfers((prev) => prev.filter((t) => !(t.peerId === event.peerId && t.relPath === event.relPath))));
		return () => {
			offProgress();
			offEnded();
		};
	}, []);
	const cancelTransfers = useCallback(async (relPath?: string) => {
		if (!relPath) cancelledRef.current = true;
		await p2p.cancelTransfers(relPath).catch(() => 0);
	}, []);
	return { transfers, cancelTransfers, cancelledRef };
}
