// Barrel export for the Iroh-backed P2P layer and Yjs CRDT sync

export * as p2p from "./transport";
export type { InviteInfo, JoinResult, IncomingMessage, FileProgress, ShareableFile } from "./transport";
export { P2PSyncProvider, type SyncSend } from "./P2PSyncProvider";
export type {
	P2PMessage,
	P2PMessageKind,
	PeerConnectionType,
	ConnectedPeerInfo,
	WorkspaceSyncSnapshot,
	WorkspaceSyncFileItem,
	DataChange,
} from "./types";
export { applyDataChange, upsertTask, upsertKanbanCard } from "./sharedData";
