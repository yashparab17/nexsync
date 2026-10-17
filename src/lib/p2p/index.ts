// Barrel export for the Iroh-backed P2P layer and Yjs CRDT sync

export * as p2p from "@/lib/p2p/transport";
export type { InviteInfo, JoinResult, IncomingMessage, FileProgress, ShareableFile, ShortCodeInfo, JoinRequest } from "@/lib/p2p/transport";
export { P2PSyncProvider, type SyncSend } from "@/lib/p2p/P2PSyncProvider";
export type {
	P2PMessage,
	P2PMessageKind,
	PeerConnectionType,
	ConnectedPeerInfo,
	WorkspaceSyncSnapshot,
	WorkspaceSyncFileItem,
	DataChange,
	NamedVersion,
} from "@/lib/p2p/types";
export { applyDataChange, upsertTask, upsertKanbanCard } from "@/lib/p2p/sharedData";
