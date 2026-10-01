import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useP2P } from "@/store/p2p/P2PContext";

// Floating list of file downloads in progress, with a cancel button for each
export default function TransferTray() {
	const { transfers, cancelTransfers } = useP2P();
	if (transfers.length === 0) return null;

	return (
		<div className="fixed bottom-3 right-3 z-50 w-72 max-w-[calc(100vw-1.5rem)] space-y-2 border bg-card p-3 text-xs shadow-lg">
			<div className="flex items-center justify-between">
				<span className="font-semibold">Downloading {transfers.length} file{transfers.length > 1 ? "s" : ""}</span>
				{transfers.length > 1 && (
					<Button variant="ghost" size="xs" onPress={() => cancelTransfers()}>
						Cancel all
					</Button>
				)}
			</div>
			{transfers.map((t) => {
				const percent = t.totalBytes > 0 ? Math.min(100, Math.round((t.receivedBytes / t.totalBytes) * 100)) : 0;
				return (
					<div key={`${t.peerId}:${t.relPath}`} className="space-y-1">
						<div className="flex items-center justify-between gap-2">
							<span className="truncate" title={t.relPath}>
								{t.relPath.split("/").pop()}
							</span>
							<span className="flex shrink-0 items-center gap-1 text-muted-foreground">
								{percent}%
								<Button variant="ghost" size="icon-xs" aria-label={`Cancel ${t.relPath}`} onPress={() => cancelTransfers(t.relPath)}>
									<X className="size-3" />
								</Button>
							</span>
						</div>
						<div className="h-1 w-full bg-muted">
							<div className="h-full bg-ctp-sky" style={{ width: `${percent}%` }} />
						</div>
					</div>
				);
			})}
		</div>
	);
}
