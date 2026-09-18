// Barrel export for P2P WebRTC networking, E2EE encryption, and CRDT synchronization

export { P2PLocalNode, type P2PLocalNodeOptions } from "./P2PLocalNode";
export { P2PPeerConnection, type P2PPeerOptions } from "./P2PPeerConnection";
export { P2PSyncProvider, type P2PSyncProviderOptions } from "./P2PSyncProvider";
export { P2PFileTransfer, type OutgoingFile, type IncomingTransfer } from "./P2PFileTransfer";
export type {
	P2PMessage,
	P2PMessageKind,
	P2PHandshakeHello,
	P2PFileHeader,
	P2PAwarenessState,
	PeerConnectionStatus,
	ConnectedPeerInfo,
	WorkspaceSyncSnapshot,
	WorkspaceSyncFileItem,
} from "./types";
