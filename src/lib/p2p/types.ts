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
	| "PING"
	| "PONG";

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

// Cryptographic Invite Code payload (encoded to Base64 for 1-click sharing)
export interface InvitePayload {
	workspaceId: string;
	workspaceName: string;
	hostPeerId: string;
	hostPeerName: string;
	role: string;
	e2eeKey: string; // Base64-encoded 256-bit AES-GCM key
	sdpOffer?: RTCSessionDescriptionInit;
	created: number;
}

// Connection Answer payload (for manual exchange or signaling response)
export interface AnswerPayload {
	joinerPeerId: string;
	joinerPeerName: string;
	sdpAnswer: RTCSessionDescriptionInit;
	created: number;
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
