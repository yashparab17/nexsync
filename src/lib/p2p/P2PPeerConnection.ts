// WebRTC Peer Connection wrapper powered by PeerJS
// PeerJS handles signaling, ICE, STUN/TURN automatically via its reliable hosted server (peerjs.com)
// This replaces the custom WebRTC/WebSocket signaling layer which depended on unreliable community servers.

import Peer, { type DataConnection } from "peerjs";
import {
	encryptPayload,
	decryptPayloadToString,
	exportRawKey,
	importRawKey,
	deriveKeyFromShortCode,
	bytesToBase64Url,
	base64UrlToBytes,
} from "@/lib/crypto/e2ee";
import type {
	P2PMessage,
	PeerConnectionStatus,
	ConnectedPeerInfo,
	InvitePayload,
} from "./types";

// ─── PeerJS Config ────────────────────────────────────────────────────────────
// Uses the free PeerJS Cloud server (peerjs.com). This is a reliable,
// always-on server maintained by the PeerJS team.
const PEERJS_CONFIG = {
	host: "0.peerjs.com",
	port: 443,
	path: "/",
	secure: true,
	debug: 0,
	config: {
		iceServers: [
			{ urls: "stun:stun.l.google.com:19302" },
			{ urls: "stun:stun1.l.google.com:19302" },
			// TURN relay servers — required for symmetric NAT (~40% of real networks)
			{
				urls: "turn:openrelay.metered.ca:80",
				username: "openrelayproject",
				credential: "openrelayproject",
			},
			{
				urls: "turn:openrelay.metered.ca:443",
				username: "openrelayproject",
				credential: "openrelayproject",
			},
			{
				urls: "turn:openrelay.metered.ca:443?transport=tcp",
				username: "openrelayproject",
				credential: "openrelayproject",
			},
		],
	},
};

// Derives a stable, deterministic PeerJS peer ID from the short code so the
// guest can dial the host directly without any out-of-band signaling.
async function deriveHostPeerjsId(shortCode: string): Promise<string> {
	const normalized = shortCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
	const encoder = new TextEncoder();
	const hashBuffer = await crypto.subtle.digest(
		"SHA-256",
		encoder.encode(`nexsync-peerjs-id-v1-${normalized}`),
	);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return "nx-" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

export interface P2PPeerOptions {
	peerId: string;
	peerName: string;
	role?: string;
}

type MessageListener = (msg: P2PMessage, peer: P2PPeerConnection) => void;
type StatusListener = (status: PeerConnectionStatus, peer: P2PPeerConnection) => void;

export class P2PPeerConnection {
	public readonly peerId: string;
	public readonly peerName: string;
	public role: string;
	public remotePeerId: string | null = null;
	public remotePeerName: string | null = null;

	public status: PeerConnectionStatus = "new";
	public latencyMs: number = 0;
	public bytesSent: number = 0;
	public bytesReceived: number = 0;
	public connectedAt: number = 0;

	private peer: Peer | null = null;
	private conn: DataConnection | null = null;
	private e2eeKey: CryptoKey | null = null;

	private messageListeners: Set<MessageListener> = new Set();
	private statusListeners: Set<StatusListener> = new Set();
	private pingInterval: ReturnType<typeof setInterval> | null = null;

	constructor(options: P2PPeerOptions) {
		this.peerId = options.peerId;
		this.peerName = options.peerName;
		this.role = options.role ?? "Editor";
	}

	public setE2eeKey(key: CryptoKey) {
		this.e2eeKey = key;
	}

	// ────────────────────────────
	// 1-Code Automated Signaling Flow (Host)
	// ────────────────────────────

	public async hostWithShortCode(
		shortCode: string,
		workspaceId: string,
		workspaceName: string,
	): Promise<string> {
		const key = await deriveKeyFromShortCode(shortCode);
		this.setE2eeKey(key);

		const hostPeerjsId = await deriveHostPeerjsId(shortCode);

		return new Promise((resolve, reject) => {
			this.peer = new Peer(hostPeerjsId, PEERJS_CONFIG);

			this.peer.on("open", (id) => {
				console.log(`[P2P] Host listening on PeerJS ID: ${id}`);
				resolve(shortCode);
			});

			this.peer.on("error", (err) => {
				// ID taken means someone else is already hosting with that code
				if ((err as any).type === "unavailable-id") {
					console.warn("[P2P] Host ID already taken — another host may be using this code.");
				}
				console.error("[P2P] PeerJS host error:", err);
				reject(err);
			});

			// When a guest connects
			this.peer.on("connection", (conn) => {
				console.log("[P2P] Incoming connection from guest:", conn.peer);
				this.conn = conn;
				this.remotePeerId = conn.peer;

				// Send workspace info to guest on channel open
				conn.on("open", () => {
					this.remotePeerName = "Collaborator";
					this.connectedAt = Date.now();
					this.setStatus("connected");
					this.startPingMonitor();

					// Greet the guest with workspace metadata
					this.sendRawMessage({
						kind: "WORKSPACE_INFO",
						senderId: this.peerId,
						senderName: this.peerName,
						timestamp: Date.now(),
						payload: JSON.stringify({ workspaceId, workspaceName }),
					});
				});

				conn.on("data", (data) => {
					this.handleIncomingData(data);
				});

				conn.on("close", () => {
					this.setStatus("disconnected");
					this.stopPingMonitor();
				});

				conn.on("error", (err) => {
					console.error("[P2P] Connection error:", err);
					this.setStatus("failed");
					this.stopPingMonitor();
				});
			});
		});
	}

	// ────────────────────────────
	// 1-Code Automated Signaling Flow (Guest)
	// ────────────────────────────

	public async joinWithShortCode(shortCode: string): Promise<{
		workspaceId: string;
		workspaceName: string;
	}> {
		const key = await deriveKeyFromShortCode(shortCode);
		this.setE2eeKey(key);

		const hostPeerjsId = await deriveHostPeerjsId(shortCode);
		const guestPeerjsId = `nx-guest-${Date.now().toString(36)}`;

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.peer?.destroy();
				reject(new Error("Connection timed out. Please verify the code and ensure the host is online."));
			}, 30000);

			this.peer = new Peer(guestPeerjsId, PEERJS_CONFIG);

			this.peer.on("open", () => {
				console.log(`[P2P] Guest connecting to host: ${hostPeerjsId}`);
				this.setStatus("connecting");

				const conn = this.peer!.connect(hostPeerjsId, {
					reliable: true,
					metadata: {
						guestPeerId: this.peerId,
						guestPeerName: this.peerName,
					},
				});

				this.conn = conn;
				this.remotePeerId = hostPeerjsId;

				conn.on("open", () => {
					console.log("[P2P] Guest connected to host.");
				});

				let handshakeResolved = false;
				conn.on("data", async (data) => {
					const msg = await this.decodeMessage(data);
					if (!msg) return;

					// First message from host carries workspace info
					if (!handshakeResolved && msg.kind === "WORKSPACE_INFO" && msg.payload) {
						handshakeResolved = true;
						clearTimeout(timeout);
						const { workspaceId, workspaceName } = JSON.parse(msg.payload);
						this.remotePeerName = msg.senderName || "Host";
						this.connectedAt = Date.now();
						this.setStatus("connected");
						this.startPingMonitor();
						resolve({ workspaceId, workspaceName });
						return;
					}

					// All subsequent messages go to listeners
					this.dispatchMessage(msg);
				});

				conn.on("close", () => {
					clearTimeout(timeout);
					this.setStatus("disconnected");
					this.stopPingMonitor();
				});

				conn.on("error", (err) => {
					clearTimeout(timeout);
					console.error("[P2P] Connection error:", err);
					this.setStatus("failed");
					reject(err);
				});
			});

			this.peer.on("error", (err) => {
				clearTimeout(timeout);
				console.error("[P2P] PeerJS guest error:", err);
				reject(err);
			});
		});
	}

	// ────────────────────────────
	// Manual Handshake (Fallback — kept for compatibility)
	// ────────────────────────────

	public async createHostInvite(
		workspaceId: string,
		workspaceName: string,
		e2eeKey: CryptoKey,
	): Promise<string> {
		this.setE2eeKey(e2eeKey);

		const guestPeerjsId = `nx-invite-${Date.now().toString(36)}`;
		this.peer = new Peer(guestPeerjsId, PEERJS_CONFIG);

		await new Promise<void>((resolve) => {
			this.peer!.on("open", () => resolve());
		});

		const rawKey = await exportRawKey(e2eeKey);
		const e2eeKeyBase64 = bytesToBase64Url(rawKey);

		const invite: InvitePayload = {
			workspaceId,
			workspaceName,
			hostPeerId: guestPeerjsId, // PeerJS peer ID used as the reachable address
			hostPeerName: this.peerName,
			role: this.role,
			e2eeKey: e2eeKeyBase64,
			sdpOffer: null as any, // Not used with PeerJS — kept for type compat
			created: Date.now(),
		};

		return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(invite)));
	}

	public async joinFromInvite(inviteCode: string): Promise<{
		workspaceId: string;
		workspaceName: string;
		answerCode: string;
	}> {
		const decoded = new TextDecoder().decode(base64UrlToBytes(inviteCode.trim()));
		const invite: InvitePayload = JSON.parse(decoded);

		const rawKey = base64UrlToBytes(invite.e2eeKey);
		const importedKey = await importRawKey(rawKey);
		this.setE2eeKey(importedKey);

		this.remotePeerId = invite.hostPeerId;
		this.remotePeerName = invite.hostPeerName;

		return {
			workspaceId: invite.workspaceId,
			workspaceName: invite.workspaceName,
			answerCode: "", // Not used with PeerJS
		};
	}

	public async acceptAnswer(_answerCode: string): Promise<void> {
		// Not used in PeerJS flow — kept for API compatibility
	}

	// ────────────────────────────
	// Messaging & Transmission
	// ────────────────────────────

	private async handleIncomingData(data: unknown) {
		const msg = await this.decodeMessage(data);
		if (!msg) return;
		this.dispatchMessage(msg);
	}

	private async decodeMessage(data: unknown): Promise<P2PMessage | null> {
		try {
			let rawBytes: Uint8Array;
			if (data instanceof ArrayBuffer) {
				rawBytes = new Uint8Array(data);
			} else if (data instanceof Uint8Array) {
				rawBytes = data;
			} else if (typeof data === "string") {
				rawBytes = new TextEncoder().encode(data);
			} else {
				return null;
			}

			this.bytesReceived += rawBytes.byteLength;

			let messageJson: string;
			if (this.e2eeKey) {
				messageJson = await decryptPayloadToString(rawBytes, this.e2eeKey);
			} else {
				messageJson = new TextDecoder().decode(rawBytes);
			}

			return JSON.parse(messageJson) as P2PMessage;
		} catch (err) {
			console.error("[P2P] Failed to decode message:", err);
			return null;
		}
	}

	private dispatchMessage(message: P2PMessage) {
		if (message.kind === "PING") {
			this.sendMessage({ kind: "PONG", senderId: this.peerId, senderName: this.peerName, timestamp: message.timestamp });
			return;
		}
		if (message.kind === "PONG") {
			this.latencyMs = Math.max(0, Date.now() - message.timestamp);
			return;
		}
		this.messageListeners.forEach((listener) => {
			try { listener(message, this); } catch (err) { console.error("[P2P] Error in message listener:", err); }
		});
	}

	// Send a raw (unencrypted) message immediately (used for WORKSPACE_INFO handshake)
	private async sendRawMessage(message: P2PMessage): Promise<void> {
		if (!this.conn || !this.conn.open) return;
		try {
			const json = JSON.stringify(message);
			const payload = this.e2eeKey
				? await encryptPayload(json, this.e2eeKey)
				: new TextEncoder().encode(json);
			this.conn.send(payload.buffer as ArrayBuffer);
			this.bytesSent += payload.byteLength;
		} catch (err) {
			console.error("[P2P] Failed to send raw message:", err);
		}
	}

	public async sendMessage(message: P2PMessage): Promise<void> {
		if (!this.conn || !this.conn.open) return;
		try {
			const json = JSON.stringify(message);
			const payload = this.e2eeKey
				? await encryptPayload(json, this.e2eeKey)
				: new TextEncoder().encode(json);
			this.conn.send(payload.buffer as ArrayBuffer);
			this.bytesSent += payload.byteLength;
		} catch (err) {
			console.error("[P2P] Failed to send encrypted message:", err);
		}
	}

	public async sendFileFrame(data: Uint8Array): Promise<void> {
		if (!this.conn || !this.conn.open) return;
		try {
			const payload = this.e2eeKey ? await encryptPayload(data, this.e2eeKey) : data;
			this.conn.send(payload.buffer as ArrayBuffer);
			this.bytesSent += payload.byteLength;
		} catch (err) {
			console.error("[P2P] Failed to send file frame:", err);
		}
	}

	public onMessage(listener: MessageListener): () => void {
		this.messageListeners.add(listener);
		return () => { this.messageListeners.delete(listener); };
	}

	public onStatusChange(listener: StatusListener): () => void {
		this.statusListeners.add(listener);
		listener(this.status, this);
		return () => { this.statusListeners.delete(listener); };
	}

	public getInfo(): ConnectedPeerInfo {
		return {
			id: this.remotePeerId ?? this.peerId,
			name: this.remotePeerName ?? this.peerName,
			role: this.role,
			status: this.status,
			latencyMs: this.latencyMs,
			bytesSent: this.bytesSent,
			bytesReceived: this.bytesReceived,
			connectedAt: this.connectedAt,
		};
	}

	private startPingMonitor() {
		this.stopPingMonitor();
		this.pingInterval = setInterval(() => {
			if (this.conn?.open) {
				this.sendMessage({ kind: "PING", senderId: this.peerId, senderName: this.peerName, timestamp: Date.now() });
			}
		}, 5000);
	}

	private stopPingMonitor() {
		if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
	}

	private setStatus(status: PeerConnectionStatus) {
		this.status = status;
		this.statusListeners.forEach((listener) => {
			try { listener(status, this); } catch (err) { console.error("[P2P] Error in status listener:", err); }
		});
	}

	public close() {
		this.stopPingMonitor();
		this.conn?.close();
		this.peer?.destroy();
		this.setStatus("closed");
		this.messageListeners.clear();
		this.statusListeners.clear();
	}
}
