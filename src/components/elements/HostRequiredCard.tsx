// Settings: whether guests may work in this workspace while its host is offline. The host and Admins choose.

import { useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { errorText } from "@/lib/utils";
import { useP2P, useSelfRole } from "@/store/p2p/P2PContext";

export default function HostRequiredCard() {
	const { requireHost, setRequireHost, selfName, peers } = useP2P();
	const role = useSelfRole();
	const [error, setError] = useState<string | null>(null);
	const guest = selfName !== null;
	// An Admin guest asks the host, so it needs the host connected; everyone else here can only read it
	const hostHere = peers.some((p) => p.isHost);
	const canChange = guest ? role === "Admin" && hostHere : true;

	const change = async (on: boolean) => {
		setError(null);
		try {
			await setRequireHost(on);
		} catch (err) {
			setError(errorText(err, "Could not change this setting."));
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Host availability</CardTitle>
				<CardDescription>
					Choose whether people who joined this workspace can use it while its host is offline. {guest ? "The host and Admins choose this." : "Admins can change this too."}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{error && (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				)}
				<label className="flex cursor-pointer items-start gap-3 text-sm">
					<input type="checkbox" checked={requireHost} disabled={!canChange} onChange={(e) => void change(e.target.checked)} className="mt-1 size-4 accent-primary" />
					<span>
						Only allow work while the host is online
						<span className="block text-xs text-muted-foreground">
							When the host is offline, guests see a "Host is offline" screen and are taken back to the Welcome page, and nothing can be edited. The host's own copy is not affected.
						</span>
						{guest && !canChange && (
							<span className="mt-1 block text-xs text-muted-foreground">
								{role === "Admin" ? "The host has to be connected for you to change this." : "Only the host and Admins can change this."}
							</span>
						)}
					</span>
				</label>
			</CardContent>
		</Card>
	);
}
