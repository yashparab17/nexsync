import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// The name this device writes under: the name it joined under, and on the host's own device (which never joined) the owner's name from the
// member list, so that the host is never "You" or "Someone" to everyone else
export function useMyName(): string {
	const { selfName } = useP2P();
	const { metadata } = useWorkspace();
	return selfName ?? metadata?.members.members.find((m) => m.role === "Owner")?.name ?? "You";
}
