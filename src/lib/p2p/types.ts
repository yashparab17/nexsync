// P2P message and peer types shared with the Rust Iroh backend

import type { WorkspaceMetadata, Task, KanbanCard, KanbanColumn } from "@/types/workspace";

export type P2PMessageKind =
	| "SYNC_STEP_1"
	| "SYNC_STEP_2"
	| "SYNC_UPDATE"
	| "AWARENESS_UPDATE" // Cursor/presence state for a Yjs doc's collaborators
	| "WORKSPACE_SYNC_REQUEST"
	| "WORKSPACE_SYNC_RESPONSE"
	| "ACTIVITY_EVENT"
	| "DATA_CHANGE" // Task/kanban edit; hosts drop these from Viewers and relay the rest
	| "MEMBERS_UPDATE" // Host's member list; only accepted from the host
	| "RULES_UPDATE" // The rules the host has turned on, as a list of ids; only accepted from the host
	| "WORKSPACE_DELETED" // The host deleted the workspace; only accepted from the host
	| "ROLE_REQUEST" // An Admin guest asking the host to change a role; only delivered to the host
	| "HOST_HANDOFF" // The host offering a guest to take over hosting; only accepted from the host
	| "HOST_READY" // The chosen guest's answer to a handoff: a fresh invite ticket, or none if declined
	| "YDOC_INVENTORY" // State summary of every stored note, sent on connect so the peer can send what is missing
	| "YDOC_UPDATE" // What one note is missing on the peer, answering an inventory
	| "VERSION_NAMED" // A collaborator naming a version of a file; hosts drop these from Viewers and relay the rest
	| "NAME_REQUEST" // A guest asking the host for a new workspace name; only delivered to the host
	| "PRESENCE" // Where a person is: page, open item, away; relayed by the host and stamped with the sender's name
	| "HOST_MOVED"; // The host telling guests the ticket of the new host; only accepted from the host

// JSON envelope carried over a peer's encrypted control stream
export interface P2PMessage {
	kind: P2PMessageKind;
	timestamp: number;
	docId?: string; // Yjs document scope for SYNC_* messages
	payload?: string; // JSON string or base64 Yjs update
	author?: string; // Who sent a VERSION_NAMED message; stamped by the receiving backend, never trusted from the sender
	authorId?: string; // The sender's device key, stamped with the author; the app swaps `author` for the member's name
}

// The payload of a VERSION_NAMED message: the text of a file at the moment someone named it
export interface NamedVersion {
	path: string;
	label: string;
	content: string;
}

// One file listed in a workspace snapshot; contents are streamed separately by Rust
export interface WorkspaceSyncFileItem {
	relPath: string;
	size: number;
	isPlaceholder: boolean; // Too large for initial sync; downloaded on demand
}

// One task or kanban edit, sent as the payload of a DATA_CHANGE message
export type DataChange =
	| { entity: "task"; op: "upsert"; task: Task }
	| { entity: "task"; op: "delete"; id: string }
	| { entity: "column"; op: "upsert"; column: KanbanColumn }
	| { entity: "column"; op: "delete"; id: string }
	| { entity: "card"; op: "upsert"; card: KanbanCard }
	| { entity: "card"; op: "delete"; id: string };

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
