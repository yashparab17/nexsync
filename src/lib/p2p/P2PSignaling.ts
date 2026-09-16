// Lightweight Decentralized Signaling Client for 1-Code WebRTC Rendezvous
// Supports both BroadcastChannel (for instant 0ms same-machine rendezvous) and WebSocket relay for internet peers

import {
	deriveKeyFromShortCode,
	hashShortCodeToRoom,
	encryptPayload,
	decryptPayloadToString,
	bytesToBase64Url,
	base64UrlToBytes,
} from "@/lib/crypto/e2ee";

export interface SignalingMessage {
	type: "offer" | "answer" | "candidate" | "request_offer" | "ping";
	senderId: string;
	room: string;
	payload: string; // E2EE-encrypted Base64 payload
}

const DEFAULT_SIGNALING_SERVERS = [
	"wss://signaling.yjs.dev",
	"wss://y-webrtc-signaling-eu.herokuapp.com",
];

export class P2PSignaling {
	private ws: WebSocket | null = null;
	private broadcastChannel: BroadcastChannel | null = null;
	private room: string = "";
	private key: CryptoKey | null = null;
	private peerId: string;
	private serverUrl: string;
	private onMessageCallbacks: Set<(data: { type: string; payload: any; senderId: string }) => void> = new Set();
	private isDestroyed: boolean = false;
	private pingTimer: ReturnType<typeof setInterval> | null = null;

	constructor(peerId: string, serverUrl: string = DEFAULT_SIGNALING_SERVERS[0]) {
		this.peerId = peerId;
		this.serverUrl = serverUrl;
	}

	// Connect to signaling room using the short code
	public async connect(shortCode: string): Promise<void> {
		this.key = await deriveKeyFromShortCode(shortCode);
		this.room = await hashShortCodeToRoom(shortCode);

		// 1. Setup local BroadcastChannel for zero-latency local testing across windows/tabs
		try {
			if (typeof BroadcastChannel !== "undefined") {
				this.broadcastChannel = new BroadcastChannel(`nexsync-signal-${this.room}`);
				this.broadcastChannel.onmessage = async (event) => {
					await this.processRawSignalingFrame(event.data);
				};
			}
		} catch (err) {
			console.warn("[Signaling] BroadcastChannel init error:", err);
		}

		// 2. Connect to remote WebSocket signaling server for internet peers
		return new Promise((resolve) => {
			try {
				this.ws = new WebSocket(this.serverUrl);

				this.ws.onopen = () => {
					console.log(`[Signaling] Connected to rendezvous server for code: ${shortCode.toUpperCase()}`);
					// Subscribe to topic
					this.sendRaw({
						type: "subscribe",
						topics: [this.room],
					});
					this.startHeartbeat();
					resolve();
				};

				this.ws.onmessage = async (event) => {
					await this.processRawSignalingFrame(event.data);
				};

				this.ws.onerror = (err) => {
					console.warn("[Signaling] WebSocket connection warning (fallback to local):", err);
					resolve(); // Don't crash, allow local BroadcastChannel or fallback
				};

				this.ws.onclose = () => {
					this.stopHeartbeat();
				};
			} catch (err) {
				console.warn("[Signaling] WebSocket failed:", err);
				resolve();
			}
		});
	}

	// Process and decrypt an incoming raw signaling frame
	private async processRawSignalingFrame(rawData: any) {
		try {
			const strData = typeof rawData === "string" ? rawData : new TextDecoder().decode(rawData);
			const msg = JSON.parse(strData);

			const senderId = msg.senderId;
			const signalType = msg.signalType || msg.type;
			const encryptedPayload = msg.payload || msg.data;

			if (senderId === this.peerId || !encryptedPayload || !this.key) return;

			// Decrypt payload with E2EE short code key
			const encryptedBytes = base64UrlToBytes(encryptedPayload);
			const decryptedJson = await decryptPayloadToString(encryptedBytes, this.key);
			const payload = JSON.parse(decryptedJson);

			this.onMessageCallbacks.forEach((cb) => {
				try {
					cb({ type: signalType, payload, senderId });
				} catch (err) {
					console.error("[Signaling] Callback error:", err);
				}
			});
		} catch {
			// Non-fatal if parsing heartbeat or extraneous server messages
		}
	}

	// Send encrypted signaling payload (offer, answer, candidate, or request_offer)
	public async send(type: "offer" | "answer" | "candidate" | "request_offer", data: any): Promise<void> {
		if (!this.key) return;

		try {
			const jsonStr = JSON.stringify(data);
			const encryptedBytes = await encryptPayload(jsonStr, this.key);
			const payloadBase64 = bytesToBase64Url(encryptedBytes);

			const frameData = {
				type: "publish",
				topic: this.room,
				signalType: type,
				senderId: this.peerId,
				payload: payloadBase64,
			};

			// Broadcast locally across all local windows
			try {
				this.broadcastChannel?.postMessage(JSON.stringify(frameData));
			} catch {
				// BroadcastChannel error fallback
			}

			// Broadcast over WebSocket network
			this.sendRaw(frameData);
		} catch (err) {
			console.error("[Signaling] Failed to send encrypted frame:", err);
		}
	}

	private sendRaw(data: any) {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(data));
		}
	}

	public onMessage(callback: (data: { type: string; payload: any; senderId: string }) => void): () => void {
		this.onMessageCallbacks.add(callback);
		return () => {
			this.onMessageCallbacks.delete(callback);
		};
	}

	private startHeartbeat() {
		this.stopHeartbeat();
		this.pingTimer = setInterval(() => {
			if (this.ws?.readyState === WebSocket.OPEN) {
				this.sendRaw({ type: "ping" });
			}
		}, 15000);
	}

	private stopHeartbeat() {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
	}

	public disconnect() {
		if (this.isDestroyed) return;
		this.isDestroyed = true;
		this.stopHeartbeat();
		if (this.broadcastChannel) {
			this.broadcastChannel.close();
			this.broadcastChannel = null;
		}
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.onMessageCallbacks.clear();
	}
}
