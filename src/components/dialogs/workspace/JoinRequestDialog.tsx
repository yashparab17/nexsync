import { UserPlus } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useP2P } from "@/store/p2p/P2PContext";

// Asks the host to allow or deny a guest who entered a 6-digit code
export default function JoinRequestDialog() {
	const { joinRequests, resolveJoinRequest } = useP2P();
	const request = joinRequests[0];
	if (!request) return null;

	return (
		<Dialog isOpen isDismissable={false} showCloseButton={false} onOpenChange={() => {}}>
			<div className="space-y-4">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<UserPlus className="size-5 text-primary" />
						<DialogTitle>Allow Someone to Join?</DialogTitle>
					</div>
					<DialogDescription>
						<span className="font-semibold text-foreground">{request.name}</span> entered your code and
						wants to join this workspace. Only allow people you expect.
					</DialogDescription>
				</DialogHeader>
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
