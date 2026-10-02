// Typed bridge to the Rust Iroh P2P node: Tauri commands plus p2p://* events

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ConnectedPeerInfo, P2PMessage } from "./types";

export interface InviteInfo {
	ticket: string;
	relayConnected: boolean; // False means only same-network guests can join
	expiresAt?: number | null; // When the invite stops working, in milliseconds since 1970
	singleUse?: boolean;
}

// Limits on an invite: how long it lasts and whether one guest uses it up
export interface InviteOptions {
	expiresInSecs?: number;
	singleUse?: boolean;
}

export interface JoinResult {
	peerId: string;
	workspaceId: string;
	workspaceName: string;
	role: string;
	hostName: string;
	// The host's address without the invite secret, kept so this device can come back as a member
	rejoinTicket: string;
}

// Tells the host who is already in the open workspace, as [device key, role] pairs, so they can come back without an invite
export function setKnownMembers(args: {
	workspaceId: string;
	workspaceName: string;
	hostName: string;
	members: [string, string][];
}): Promise<void> {
	return invoke("p2p_set_known_members", args);
}

export interface ShortCodeInfo {
	code: string;
	expiresAt: number; // Milliseconds since the Unix epoch
	relayConnected: boolean;
}

// A guest asking to join with a short code, waiting for the host to allow or deny
export interface JoinRequest {
	requestId: string;
	name: string;
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

// This device's own P2P key, which hosts record as the device's identity
export function selfId(): Promise<string> {
	return invoke("p2p_self_id");
}

// Tell the backend which role each device key holds so the host enforces the member list
export function setRoles(roles: [string, string][]): Promise<void> {
	return invoke("p2p_set_roles", { roles });
}

// Invoke backend command to mint an invite ticket for the active workspace
export function createInvite(args: {
	role: string;
	workspaceId: string;
	workspaceName: string;
	hostName: string;
	options?: InviteOptions;
}): Promise<InviteInfo> {
	return invoke("p2p_create_invite", args);
}

// Disconnect a guest and refuse it until a new invite is made
export function blockDevice(deviceId: string): Promise<void> {
	return invoke("p2p_block_device", { deviceId });
}

// Invoke backend command to stop admitting guests with the current ticket
export function revokeInvite(): Promise<void> {
	return invoke("p2p_revoke_invite");
}

// True if the text looks like a 6-digit short code rather than a full invite ticket
export function isShortCode(input: string): boolean {
	return /^\s*\d{3}[\s-]?\d{3}\s*$/.test(input);
}

// Invoke backend command to mint a 6-digit code (with its invite) for the active workspace
export function createShortCode(args: {
	role: string;
	workspaceId: string;
	workspaceName: string;
	hostName: string;
}): Promise<ShortCodeInfo> {
	return invoke("p2p_create_short_code", args);
}

// Invoke backend command to join a host with a short code once the host allows it
export function joinWithCode(code: string, displayName: string): Promise<JoinResult> {
	return invoke("p2p_join_with_code", { code, displayName });
}

// Invoke backend command to answer a guest's request to join
export function resolveJoinRequest(requestId: string, approve: boolean): Promise<boolean> {
	return invoke("p2p_resolve_join_request", { requestId, approve });
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

// Whether this device can reach the relay that links it to peers on other networks
export interface NetworkStatus {
	online: boolean;
	detail: string | null; // Why the relay is unreachable; a firewall or proxy is the usual cause
}

// Current relay reachability; also starts the network so changes are reported from here on
export function networkStatus(): Promise<NetworkStatus> {
	return invoke("p2p_network_status");
}

// The OS said the network changed, so re-probe now instead of waiting for the next timer
export function networkChange(): Promise<void> {
	return invoke("p2p_network_change");
}

// Invoke backend command to re-dial the host after the automatic attempts gave up
export function retryConnection(): Promise<void> {
	return invoke("p2p_retry_connection");
}

// Invoke backend command to stream a file from a peer into the local workspace
// Cancel the download of one file, or every download; what arrived is kept so it can resume
export function cancelTransfers(relPath?: string): Promise<number> {
	return invoke("p2p_cancel_transfers", { relPath: relPath ?? null });
}

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

// A guest is asking to join with a short code
export const onJoinRequest = (handler: (request: JoinRequest) => void) =>
	subscribe<JoinRequest>("p2p://join-request", handler);

// A join request was answered, expired or cancelled
export const onJoinRequestClosed = (handler: (event: { requestId: string }) => void) =>
	subscribe<{ requestId: string }>("p2p://join-request-closed", handler);

// A catch-up merge changed tasks or kanban in the local database
export const onDataChanged = (handler: () => void) =>
	subscribe<null>("p2p://data-changed", () => handler());

// The link to the host dropped and the backend is re-dialing it
export const onReconnecting = (handler: (event: { attempt: number; max: number }) => void) =>
	subscribe<{ attempt: number; max: number }>("p2p://reconnecting", handler);

// The backend gave up re-dialing the host
export const onReconnectFailed = (handler: () => void) =>
	subscribe<null>("p2p://reconnect-failed", () => handler());

// The relay became reachable or unreachable
export const onNetwork = (handler: (status: NetworkStatus) => void) =>
	subscribe<NetworkStatus>("p2p://network", handler);

export const onMessage = (handler: (event: IncomingMessage) => void) =>
	subscribe<IncomingMessage>("p2p://message", handler);

export const onFileEnded = (handler: (event: { peerId: string; relPath: string }) => void) =>
	subscribe<{ peerId: string; relPath: string }>("p2p://file-ended", handler);

export const onFileProgress = (handler: (event: FileProgress) => void) =>
	subscribe<FileProgress>("p2p://file-progress", handler);

// A collaborator's change was written to (or trashed from) the shared workspace
export const onFilesChanged = (handler: (event: { relPath: string }) => void) =>
	subscribe<{ relPath: string }>("p2p://files-changed", handler);

export interface RemoteFileEvent {
	peerId: string;
	relPath: string;
	size: number;
}

// A collaborator changed a file too large to download automatically
export const onRemoteFile = (handler: (event: RemoteFileEvent) => void) =>
	subscribe<RemoteFileEvent>("p2p://remote-file", handler);
