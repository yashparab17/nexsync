import { useState } from "react";
import { Crown } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { errorText } from "@/lib/utils";
import { useP2P } from "@/store/p2p/P2PContext";

// Asks a guest whether to take over as host and Owner when the current host offers it
export default function HostHandoffDialog() {
	const { handoffOffer, acceptHandoff, declineHandoff } = useP2P();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	if (!handoffOffer) return null;

	const accept = async () => {
		try {
			setBusy(true);
			setError(null);
			await acceptHandoff();
		} catch (err) {
			setError(errorText(err, "Could not take over as host."));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog isOpen isDismissable={false} showCloseButton={false} onOpenChange={() => {}}>
			<div className="space-y-4">
				<DialogHeading icon={<Crown className="size-6" />} tone="warning" title="Become the Host?" description={<>{handoffOffer.hostName} wants to make you the Owner and host of this workspace. Collaborators will
						reconnect to this device, so keep Nexsync open while they work. {handoffOffer.hostName} stays on as an
						Admin.</>} />
				{error && <p className="text-xs text-destructive">{error}</p>}
				<DialogFooter>
					<Button variant="outline" isDisabled={busy} onPress={declineHandoff}>
						Decline
					</Button>
					<Button isDisabled={busy} onPress={accept}>
						{busy ? "Taking Over…" : "Become Host"}
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
