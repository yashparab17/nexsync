// P2P DataChannel and Handshake Protocol Types

import type {
	WorkspaceMetadata,
	Task,
	KanbanColumn,
} from "@/types/workspace";

export type P2PMessageKind =
	| "SYNC_STEP_1"
	| "SYNC_STEP_2"
	| "SYNC_UPDATE"
	| "FILE_START"
	| "FILE_CHUNK"
	| "FILE_COMPLETE"
	| "FILE_REQUEST"
	| "WORKSPACE_SYNC_REQUEST"
	| "WORKSPACE_SYNC_RESPONSE"
	| "ACTIVITY_EVENT"
	| "MUTATION_BROADCAST"
	| "AWARENESS_UPDATE"
	| "WORKSPACE_INFO"
	| "PING"
	| "PONG";

// Protocol version guard so future breaking changes to the wire format fail
// loudly on a version mismatch instead of silently corrupting state.
export const P2P_PROTOCOL_VERSION = 2;

// Upper bound on a single decoded/decrypted message, before JSON.parse ever
// runs on it. Guards against a malicious or buggy peer sending an oversized
// frame to exhaust memory. Large payloads (files, snapshots) are chunked
// below this limit by P2PFileTransfer.
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024; // 4 MB

// Plaintext handshake message exchanged once the DataChannel opens, before
// any application data is sent. Proves (via the code-derived HMAC) that both
// sides know the pairing short code, then carries the ephemeral X25519 public
// key used to derive a fresh, forward-secret AES-256-GCM session key.
export interface P2PHandshakeHello {
	v: typeof P2P_PROTOCOL_VERSION;
	kind: "P2P_HELLO";
	senderId: string;
	senderName: string;
	role: string;
	ephemeralPublicKey: string; // base64url X25519 public key
	nonce: string; // base64url random 16 bytes, mixed into the session key salt
	mac?: string; // base64url HMAC-SHA256(codeAuthKey, ephemeralPublicKey || nonce); omitted for invite-link connections
}

// Core framed message sent across encrypted DataChannels
export interface P2PMessage {
	kind: P2PMessageKind;
	senderId: string;
	senderName: string;
	timestamp: number;
	docId?: string; // Optional document scope for Yjs messages
	payload?: string; // Base64-encoded binary payload or JSON string
}

// File item inside a full workspace snapshot
export interface WorkspaceSyncFileItem {
	relPath: string;
	content: string; // Text content or Base64 string for binary files
	isBinary?: boolean;
	size?: number;
	isPlaceholder?: boolean;
}


// Full snapshot exchanged upon initial join/handshake
export interface WorkspaceSyncSnapshot {
	workspaceId: string;
	workspaceName: string;
	metadata: WorkspaceMetadata;
	tasks: Task[];
	kanban: KanbanColumn[];
	files: WorkspaceSyncFileItem[];
}

// File chunk transfer descriptor
export interface P2PFileHeader {
	fileId: string;
	fileName: string;
	relPath: string;
	totalBytes: number;
	totalChunks: number;
	mimeType: string;
	sha256?: string;
}

// Peer awareness / live cursor state
export interface P2PAwarenessState {
	peerId: string;
	peerName: string;
	role: string;
	activeDocId?: string;
	color: string;
	lastSeen: number;
}

// Peer metrics and connection state
export type PeerConnectionStatus =
	| "new"
	| "connecting"
	| "connected"
	| "disconnected"
	| "failed"
	| "closed";

export interface ConnectedPeerInfo {
	id: string;
	name: string;
	role: string;
	status: PeerConnectionStatus;
	latencyMs: number;
	bytesSent: number;
	bytesReceived: number;
	connectedAt: number;
}
