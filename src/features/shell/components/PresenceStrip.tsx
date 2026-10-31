// Header strip of everyone connected: who is online or away, where they are, how they are connected, and following one of them

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import Avatar from "@/components/elements/Avatar";
import { followPath, placeLabel } from "@/lib/p2p/presence";
import { cn } from "@/lib/utils";
import { useP2P } from "@/store/p2p/P2PContext";
import type { ConnectedPeerInfo } from "@/lib/p2p/types";

const route = (p: ConnectedPeerInfo) => (p.connectionType === "direct" ? "Direct" : p.connectionType === "relay" ? "Through a relay" : "Connecting");

export default function PresenceStrip() {
	const { peers, presence, nameOf } = useP2P();
	const navigate = useNavigate();
	const [following, setFollowing] = useState<string | null>(null);

	// Go where the followed person goes, each time they move
	const there = following ? presence[following] : undefined;
	useEffect(() => {
		if (there) navigate(followPath(there));
	}, [there?.page, there?.item, there?.line]); // eslint-disable-line react-hooks/exhaustive-deps

	// Someone who disconnects can no longer be followed
	useEffect(() => {
		if (following && !peers.some((p) => p.id === following)) setFollowing(null);
	}, [following, peers]);

	if (peers.length === 0) return null;

	return (
		<div className="flex items-center gap-2">
			<div className="flex items-center -space-x-1">
				{peers.map((peer) => {
					const who = nameOf(peer.id);
					const where = presence[peer.id];
					const away = where?.away === true;
					const followed = following === peer.id;
					const detail = `${who}${where ? `: ${placeLabel(where)}` : ""}. ${route(peer)}${peer.connectionType === "connecting" ? "" : `, ${Math.round(peer.latencyMs)} ms`}.`;
					return (
						<button
							key={peer.id}
							type="button"
							onClick={() => setFollowing(followed ? null : peer.id)}
							disabled={!where}
							aria-pressed={followed}
							aria-label={where ? `${followed ? "Stop following" : "Follow"} ${who}` : who}
							title={`${detail}${where ? (followed ? " Click to stop following." : " Click to follow.") : ""}`}
							className={cn(
								"relative size-7 ring-2 ring-background",
								away && "opacity-60",
								followed && "ring-primary",
							)}
						>
							{/* The picture the person chose, or their letter on their colour */}
							<Avatar name={who} className="size-7 rounded-none text-xs" />
							<span className={cn("absolute -bottom-0.5 -right-0.5 size-2 ring-1 ring-background", away ? "bg-warning" : "bg-success")} />
						</button>
					);
				})}
			</div>
{following && <span className="hidden text-xs text-primary md:inline">Following {nameOf(following)}</span>}
		</div>
	);
}
