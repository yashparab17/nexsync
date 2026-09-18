// Wraps a single encrypted WebRTC DataConnection to one remote peer.
//
// Ownership split (fixes the old multi-guest bug): this class no longer owns
// a PeerJS `Peer`. A host that accepts N simultaneous guests used to funnel
// all of them through one `this.conn`, so the second guest silently stole the
// first guest's connection. Now `P2PLocalNode` owns the one `Peer` per app
// instance and hands each inbound/outbound `DataConnection` to its own
// `P2PPeerConnection`, so a host can hold an arbitrary number of guests.
//
// Handshake: on open, both sides exchange a plaintext P2P_HELLO carrying a
// fresh X25519 public key (generated in Rust — WebView X25519 support is
// inconsistent). For short-code pairing, the HELLO is also HMAC-signed with a
// key derived from the code, so a peer that doesn't know the code is rejected
// before any application data is exchanged. The final AES-256-GCM session key
// is then derived via HKDF from the ECDH shared secret plus both nonces, so
// it is unique and forward-secret per session — never the code itself.

import type { DataConnection } from "peerjs";
import {
	encryptPayload,
	decryptPayloadToString,
	bytesToBase64Url,
	base64UrlToBytes,
	hkdfDeriveAesKey,
	signWithAuthKey,
	verifyWithAuthKey,
} from "@/lib/crypto/e2ee";
import { generateX25519KeyPair, deriveX25519SharedSecret } from "@/lib/tauri";
import {
	P2P_PROTOCOL_VERSION,
	MAX_MESSAGE_BYTES,
	type P2PMessage,
	type P2PHandshakeHello,
	type PeerConnectionStatus,
	type ConnectedPeerInfo,
} from "./types";

export interface P2PPeerOptions {
	peerId: string;
	peerName: string;
	role?: string;
	// HMAC key proving knowledge of the pairing short code. Omit for
	// invite-link connections, where reachability at the (random, unguessable)
	// PeerJS ID is itself the capability being granted.
	codeAuthKey?: CryptoKey | null;
	// Handshake must complete within this window or the connection is dropped.
	handshakeTimeoutMs?: number;
}

type MessageListener = (msg: P2PMessage, peer: P2PPeerConnection) => void;
type StatusListener = (status: PeerConnectionStatus, peer: P2PPeerConnection) => void;

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000;

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

	private conn: DataConnection;
	private sessionKey: CryptoKey | null = null;
	private codeAuthKey: CryptoKey | null;
	private handshakeTimeoutMs: number;
	private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
	private localEphemeralPublicKey: string | null = null;
	private localEphemeralSecretKey: string | null = null;
	private localNonce: Uint8Array;
	private outgoingQueue: P2PMessage[] = [];

	private messageListeners: Set<MessageListener> = new Set();
	private statusListeners: Set<StatusListener> = new Set();
	private pingInterval: ReturnType<typeof setInterval> | null = null;

	constructor(conn: DataConnection, options: P2PPeerOptions) {
		this.conn = conn;
		this.peerId = options.peerId;
		this.peerName = options.peerName;
		this.role = options.role ?? "Editor";
		this.codeAuthKey = options.codeAuthKey ?? null;
		this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
		this.localNonce = window.crypto.getRandomValues(new Uint8Array(16));
		this.remotePeerId = conn.peer;

		this.bindConnectionEvents();
	}

	private bindConnectionEvents() {
		if (this.conn.open) {
			// Already open (rare, but possible if attached late) — start immediately.
			void this.beginHandshake();
		} else {
			this.conn.on("open", () => {
				void this.beginHandshake();
			});
		}

		this.conn.on("data", (data) => {
			void this.handleIncomingData(data);
		});

		this.conn.on("close", () => {
			this.setStatus("disconnected");
			this.stopPingMonitor();
			this.clearHandshakeTimer();
		});

		this.conn.on("error", (err) => {
			console.error("[P2P] Connection error:", err);
			this.setStatus("failed");
			this.stopPingMonitor();
			this.clearHandshakeTimer();
		});
	}

	// ────────────────────────────
	// Handshake (X25519 ECDH + HKDF, optionally HMAC-authenticated by code)
	// ────────────────────────────

	private async beginHandshake() {
		this.setStatus("connecting");

		this.handshakeTimer = setTimeout(() => {
			if (this.status !== "connected") {
				console.warn("[P2P] Handshake timed out; closing connection.");
				this.close();
			}
		}, this.handshakeTimeoutMs);

		try {
			const { publicKey, secretKey } = await generateX25519KeyPair();
			this.localEphemeralPublicKey = publicKey;
			this.localEphemeralSecretKey = secretKey;

			const nonceB64 = bytesToBase64Url(this.localNonce);
			let mac: string | undefined;
			if (this.codeAuthKey) {
				const macInput = new TextEncoder().encode(`${publicKey}.${nonceB64}`);
				mac = bytesToBase64Url(await signWithAuthKey(this.codeAuthKey, macInput));
			}

			const hello: P2PHandshakeHello = {
				v: P2P_PROTOCOL_VERSION,
				kind: "P2P_HELLO",
				senderId: this.peerId,
				senderName: this.peerName,
				role: this.role,
				ephemeralPublicKey: publicKey,
				nonce: nonceB64,
				mac,
			};

			this.conn.send(JSON.stringify(hello));
		} catch (err) {
			console.error("[P2P] Failed to start handshake:", err);
			this.setStatus("failed");
			this.close();
		}
	}

	private async completeHandshake(hello: P2PHandshakeHello) {
		if (!this.localEphemeralSecretKey || !this.localEphemeralPublicKey) {
			console.error("[P2P] Received HELLO before local handshake was ready; dropping.");
			return;
		}

		if (hello.v !== P2P_PROTOCOL_VERSION) {
			console.warn("[P2P] Peer protocol version mismatch; rejecting connection.");
			this.close();
			return;
		}

		// Verify the peer knows the pairing short code before trusting anything
		// else it sends. A peer that merely guessed/squatted the rendezvous ID
		// without the code fails here and is disconnected with no further data
		// ever having been exchanged.
		if (this.codeAuthKey) {
			if (!hello.mac) {
				console.warn("[P2P] Peer did not present a code proof; rejecting connection.");
				this.close();
				return;
			}
			const macInput = new TextEncoder().encode(`${hello.ephemeralPublicKey}.${hello.nonce}`);
			const valid = await verifyWithAuthKey(
				this.codeAuthKey,
				macInput,
				base64UrlToBytes(hello.mac),
			);
			if (!valid) {
				console.warn("[P2P] Peer failed code verification; rejecting connection.");
				this.close();
				return;
			}
		}

		try {
			const sharedSecretB64 = await deriveX25519SharedSecret(
				this.localEphemeralSecretKey,
				hello.ephemeralPublicKey,
			);
			const sharedSecret = base64UrlToBytes(sharedSecretB64);

			// Salt mixes both nonces so replaying an old HELLO can never
			// reproduce a prior session's key, even with the same keypair.
			const remoteNonce = base64UrlToBytes(hello.nonce);
			const salt = new Uint8Array(this.localNonce.length + remoteNonce.length);
			salt.set(this.localNonce, 0);
			salt.set(remoteNonce, this.localNonce.length);

			this.sessionKey = await hkdfDeriveAesKey(sharedSecret, salt, "nexsync-p2p-session-v2");

			this.remotePeerId = hello.senderId;
			this.remotePeerName = hello.senderName;
			this.connectedAt = Date.now();
			this.clearHandshakeTimer();
			this.setStatus("connected");
			this.startPingMonitor();

			// Flush anything queued while the handshake was still in flight.
			const queued = this.outgoingQueue;
			this.outgoingQueue = [];
			for (const msg of queued) {
				await this.sendMessage(msg);
			}
		} catch (err) {
			console.error("[P2P] Failed to complete handshake:", err);
			this.setStatus("failed");
			this.close();
		}
	}

	private clearHandshakeTimer() {
		if (this.handshakeTimer) {
			clearTimeout(this.handshakeTimer);
			this.handshakeTimer = null;
		}
	}

	// ────────────────────────────
	// Messaging & Transmission
	// ────────────────────────────

	private async handleIncomingData(data: unknown) {
		try {
			let rawBytes: Uint8Array;
			if (data instanceof ArrayBuffer) {
				rawBytes = new Uint8Array(data);
			} else if (data instanceof Uint8Array) {
				rawBytes = data;
			} else if (typeof data === "string") {
				rawBytes = new TextEncoder().encode(data);
			} else {
				return;
			}

			if (rawBytes.byteLength > MAX_MESSAGE_BYTES) {
				console.warn("[P2P] Dropping oversized frame from peer:", rawBytes.byteLength);
				return;
			}

			this.bytesReceived += rawBytes.byteLength;

			// Before the session key exists, the only legitimate frame is the
			// plaintext handshake HELLO.
			if (!this.sessionKey) {
				const asString = new TextDecoder().decode(rawBytes);
				const parsed = JSON.parse(asString);
				if (parsed?.kind === "P2P_HELLO") {
					await this.completeHandshake(parsed as P2PHandshakeHello);
				} else {
					console.warn("[P2P] Ignoring non-handshake frame before session key exists.");
				}
				return;
			}

			const messageJson = await decryptPayloadToString(rawBytes, this.sessionKey);
			const message = this.parseMessage(messageJson);
			if (message) this.dispatchMessage(message);
		} catch (err) {
			console.error("[P2P] Failed to decode incoming frame:", err);
		}
	}

	private parseMessage(json: string): P2PMessage | null {
		try {
			const parsed = JSON.parse(json);
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				typeof parsed.kind !== "string" ||
				typeof parsed.senderId !== "string"
			) {
				console.warn("[P2P] Rejecting malformed message frame.");
				return null;
			}
			return parsed as P2PMessage;
		} catch {
			console.warn("[P2P] Rejecting non-JSON message frame.");
			return null;
		}
	}

	private dispatchMessage(message: P2PMessage) {
		if (message.kind === "PING") {
			void this.sendMessage({
				kind: "PONG",
				senderId: this.peerId,
				senderName: this.peerName,
				timestamp: message.timestamp,
			});
			return;
		}
		if (message.kind === "PONG") {
			this.latencyMs = Math.max(0, Date.now() - message.timestamp);
			return;
		}
		this.messageListeners.forEach((listener) => {
			try {
				listener(message, this);
			} catch (err) {
				console.error("[P2P] Error in message listener:", err);
			}
		});
	}

	// Sends an application message. Messages sent before the handshake
	// finishes are queued rather than silently dropped, so callers that wire
	// up peers eagerly (e.g. immediately after `onPeerJoined`) don't race the
	// handshake.
	public async sendMessage(message: P2PMessage): Promise<void> {
		if (!this.conn.open) return;
		if (!this.sessionKey) {
			this.outgoingQueue.push(message);
			return;
		}
		try {
			const json = JSON.stringify(message);
			const payload = await encryptPayload(json, this.sessionKey);
			this.conn.send(payload.buffer as ArrayBuffer);
			this.bytesSent += payload.byteLength;
		} catch (err) {
			console.error("[P2P] Failed to send encrypted message:", err);
		}
	}

	// Sends a pre-framed binary chunk (used by P2PFileTransfer, which already
	// encodes chunk metadata into the P2PMessage envelope before calling this).
	public async sendFileFrame(data: Uint8Array): Promise<void> {
		if (!this.conn.open || !this.sessionKey) return;
		try {
			const payload = await encryptPayload(data, this.sessionKey);
			this.conn.send(payload.buffer as ArrayBuffer);
			this.bytesSent += payload.byteLength;
		} catch (err) {
			console.error("[P2P] Failed to send file frame:", err);
		}
	}

	// Underlying RTCDataChannel buffered amount, for backpressure-aware senders
	// like P2PFileTransfer. Falls back to 0 if PeerJS doesn't expose it.
	public get bufferedAmount(): number {
		return this.conn.dataChannel?.bufferedAmount ?? 0;
	}

	public isOpen(): boolean {
		return this.conn.open && this.sessionKey !== null;
	}

	public onMessage(listener: MessageListener): () => void {
		this.messageListeners.add(listener);
		return () => {
			this.messageListeners.delete(listener);
		};
	}

	public onStatusChange(listener: StatusListener): () => void {
		this.statusListeners.add(listener);
		listener(this.status, this);
		return () => {
			this.statusListeners.delete(listener);
		};
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
			if (this.conn.open) {
				void this.sendMessage({
					kind: "PING",
					senderId: this.peerId,
					senderName: this.peerName,
					timestamp: Date.now(),
				});
			}
		}, 5000);
	}

	private stopPingMonitor() {
		if (this.pingInterval) {
			clearInterval(this.pingInterval);
			this.pingInterval = null;
		}
	}

	private setStatus(status: PeerConnectionStatus) {
		this.status = status;
		this.statusListeners.forEach((listener) => {
			try {
				listener(status, this);
			} catch (err) {
				console.error("[P2P] Error in status listener:", err);
			}
		});
	}

	// Closes only this connection. The shared PeerJS `Peer` (owned by
	// P2PLocalNode) and any other peers' connections are unaffected.
	public close() {
		this.stopPingMonitor();
		this.clearHandshakeTimer();
		this.conn.close();
		this.setStatus("closed");
		this.messageListeners.clear();
		this.statusListeners.clear();
	}
}
