// Whether the relay is reachable, and why not. The OS knows the network changed before Iroh does: this shows offline at once, and makes
// Iroh re-probe when it returns.

import { useEffect, useState } from "react";

import { p2p } from "@/lib/p2p";

export function useNetworkStatus(): p2p.NetworkStatus {
	const [network, setNetwork] = useState<p2p.NetworkStatus>({ online: navigator.onLine, detail: null });
	useEffect(() => {
		const offNetwork = p2p.onNetwork(setNetwork);
		const goOffline = () => setNetwork({ online: false, detail: "No network connection." });
		const goOnline = () => p2p.networkChange().catch(() => {});
		window.addEventListener("offline", goOffline);
		window.addEventListener("online", goOnline);
		p2p.networkStatus().then((status) => status && setNetwork(status)).catch(() => {});
		return () => {
			offNetwork();
			window.removeEventListener("offline", goOffline);
			window.removeEventListener("online", goOnline);
		};
	}, []);
	return network;
}
