// Typed bridge to the Rust Iroh P2P node: Tauri commands plus p2p://* events

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ConnectedPeerInfo, P2PMessage } from "./types";

export interface InviteInfo {
	ticket: string;
	relayConnected: boolean; // False means only same-network guests can join
}

export interface JoinResult {
	peerId: string;
	workspaceId: string;
	workspaceName: string;
	role: string;
	hostName: string;
}

export interface ShareableFile {
	relPath: string;
	size: number;
}

export interface IncomingMessage {
	peerId: string;
	message: P2PMessage;
}

export interface FileProgress {
	peerId: string;
	relPath: string;
	receivedBytes: number;
	totalBytes: number;
}

// Invoke backend command to set the workspace folder peers may read from
export function setSharedWorkspace(workspacePath: string | null): Promise<void> {
	return invoke("p2p_set_workspace", { workspacePath });
}

// Invoke backend command to mint an invite ticket for the active workspace
export function createInvite(args: {
	role: string;
	workspaceId: string;
	workspaceName: string;
	hostName: string;
}): Promise<InviteInfo> {
	return invoke("p2p_create_invite", args);
}

// Invoke backend command to stop admitting guests with the current ticket
export function revokeInvite(): Promise<void> {
	return invoke("p2p_revoke_invite");
}

// Invoke backend command to dial a host and complete the invite handshake
export function joinWithTicket(ticket: string, displayName: string): Promise<JoinResult> {
	return invoke("p2p_join", { ticket, displayName });
}

// Invoke backend command to send a message to one peer, or to all peers when peerId is omitted
export function sendMessage(message: P2PMessage, peerId?: string): Promise<number> {
	return invoke("p2p_send", { peerId: peerId ?? null, message });
}

// Invoke backend command to list connected peers
export function listPeers(): Promise<ConnectedPeerInfo[]> {
	return invoke("p2p_list_peers");
}

// Invoke backend command to drop one peer connection
export function disconnectPeer(peerId: string): Promise<void> {
	return invoke("p2p_disconnect", { peerId });
}

// Invoke backend command to drop every peer and revoke the current invite
export function disconnectAll(): Promise<void> {
	return invoke("p2p_disconnect_all");
}

// Invoke backend command to stream a file from a peer into the local workspace
export function fetchFile(peerId: string, workspacePath: string, relPath: string): Promise<number> {
	return invoke("p2p_fetch_file", { peerId, workspacePath, relPath });
}

// Invoke backend command to list every file a workspace shares with peers
export function listShareableFiles(workspacePath: string): Promise<ShareableFile[]> {
	return invoke("p2p_list_shareable_files", { workspacePath });
}

// Subscribes to a backend event and returns a synchronous unsubscribe for use in effects
function subscribe<T>(event: string, handler: (payload: T) => void): () => void {
	let unlisten: (() => void) | null = null;
	let disposed = false;
	listen<T>(event, (e) => handler(e.payload))
		.then((fn) => {
			if (disposed) fn();
			else unlisten = fn;
		})
		.catch((err) => console.error(`[P2P] Failed to listen for ${event}:`, err));
	return () => {
		disposed = true;
		unlisten?.();
	};
}

export const onPeers = (handler: (peers: ConnectedPeerInfo[]) => void) =>
	subscribe<ConnectedPeerInfo[]>("p2p://peers", handler);

export const onPeerJoined = (handler: (peer: ConnectedPeerInfo) => void) =>
	subscribe<ConnectedPeerInfo>("p2p://peer-joined", handler);

export const onPeerLeft = (handler: (event: { peerId: string }) => void) =>
	subscribe<{ peerId: string }>("p2p://peer-left", handler);

export const onMessage = (handler: (event: IncomingMessage) => void) =>
	subscribe<IncomingMessage>("p2p://message", handler);

export const onFileProgress = (handler: (event: FileProgress) => void) =>
	subscribe<FileProgress>("p2p://file-progress", handler);
