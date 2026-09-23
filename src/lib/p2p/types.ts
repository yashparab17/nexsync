// P2P message and peer types shared with the Rust Iroh backend

import type { WorkspaceMetadata, Task, KanbanColumn } from "@/types/workspace";

export type P2PMessageKind =
	| "SYNC_STEP_1"
	| "SYNC_STEP_2"
	| "SYNC_UPDATE"
	| "WORKSPACE_SYNC_REQUEST"
	| "WORKSPACE_SYNC_RESPONSE"
	| "ACTIVITY_EVENT";

// JSON envelope carried over a peer's encrypted control stream
export interface P2PMessage {
	kind: P2PMessageKind;
	timestamp: number;
	docId?: string; // Yjs document scope for SYNC_* messages
	payload?: string; // JSON string or base64 Yjs update
}

// One file listed in a workspace snapshot; contents are streamed separately by Rust
export interface WorkspaceSyncFileItem {
	relPath: string;
	size: number;
	isPlaceholder: boolean; // Too large for initial sync; downloaded on demand
}

// Workspace state sent by a host to a guest that asks for it
export interface WorkspaceSyncSnapshot {
	workspaceId: string;
	workspaceName: string;
	metadata: WorkspaceMetadata;
	tasks: Task[];
	kanban: KanbanColumn[];
	files: WorkspaceSyncFileItem[];
}

// "direct" = hole-punched UDP, "relay" = via an Iroh relay server
export type PeerConnectionType = "direct" | "relay" | "connecting";

// Live state of a connected peer, pushed by the backend every few seconds
export interface ConnectedPeerInfo {
	id: string;
	name: string;
	role: string;
	status: "connected";
	latencyMs: number;
	bytesSent: number;
	bytesReceived: number;
	connectedAt: number;
	connectionType: PeerConnectionType;
	isHost: boolean; // True for the host whose workspace we joined
}
