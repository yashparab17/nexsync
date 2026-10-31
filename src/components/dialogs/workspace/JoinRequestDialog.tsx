import { UserPlus } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { useP2P } from "@/store/p2p/P2PContext";

// Asks the host to allow or deny a guest who entered a 6-digit code
export default function JoinRequestDialog() {
	const { joinRequests, resolveJoinRequest } = useP2P();
	const request = joinRequests[0];
	if (!request) return null;

	return (
		<Dialog isOpen isDismissable={false} showCloseButton={false} onOpenChange={() => {}}>
			<div className="space-y-4">
				<DialogHeading icon={<UserPlus className="size-6" />} title="Allow Someone to Join?" description={<><span className="font-semibold text-foreground">{request.name}</span> entered your code. Allow only people you expect.</>} />
				<DialogFooter>
					<Button variant="outline" onPress={() => resolveJoinRequest(request.requestId, false)}>
						Deny
					</Button>
					<Button onPress={() => resolveJoinRequest(request.requestId, true)}>Allow</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
