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

// Ordered list of public signaling servers — tried in order on failure.
// Note: wss://y-webrtc-signaling-eu.herokuapp.com was removed (Heroku free tier shut down Nov 2022).
const DEFAULT_SIGNALING_SERVERS = [
	"wss://signaling.yjs.dev",
	"wss://demos.yjs.dev",
	"wss://signaling.fly.dev",
];

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 1500;

export class P2PSignaling {
	private ws: WebSocket | null = null;
	private broadcastChannel: BroadcastChannel | null = null;
	private room: string = "";
	private key: CryptoKey | null = null;
	private peerId: string;
	private serverIndex: number = 0;
	private onMessageCallbacks: Set<(data: { type: string; payload: any; senderId: string }) => void> = new Set();
	private isDestroyed: boolean = false;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private reconnectAttempt: number = 0;

	constructor(peerId: string) {
		this.peerId = peerId;
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

		// 2. Connect to remote WebSocket signaling server for internet peers (with fallback)
		await this.connectWebSocket(shortCode);
	}

	// Attempt WebSocket connection with automatic server fallback and exponential backoff
	private connectWebSocket(shortCode: string): Promise<void> {
		if (this.isDestroyed) return Promise.resolve();

		const serverUrl = DEFAULT_SIGNALING_SERVERS[this.serverIndex % DEFAULT_SIGNALING_SERVERS.length];
		console.log(`[Signaling] Connecting to ${serverUrl} (attempt ${this.reconnectAttempt + 1})`);

		return new Promise((resolve) => {
			let resolved = false;
			const doResolve = () => {
				if (!resolved) { resolved = true; resolve(); }
			};

			const connectTimeout = setTimeout(() => {
				// If WS didn't open within 5s, treat as failure
				if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
					this.ws.close();
				}
			}, 5000);

			try {
				this.ws = new WebSocket(serverUrl);

				this.ws.onopen = () => {
					clearTimeout(connectTimeout);
					this.reconnectAttempt = 0;
					console.log(`[Signaling] Connected to rendezvous server: ${serverUrl} (code: ${shortCode.toUpperCase()})`);
					this.sendRaw({
						type: "subscribe",
						topics: [this.room],
					});
					this.startHeartbeat();
					doResolve();
				};

				this.ws.onmessage = async (event) => {
					await this.processRawSignalingFrame(event.data);
				};

				this.ws.onerror = () => {
					clearTimeout(connectTimeout);
					console.warn(`[Signaling] Server ${serverUrl} failed.`);
				};

				this.ws.onclose = () => {
					clearTimeout(connectTimeout);
					this.stopHeartbeat();
					// Attempt reconnect with next server if not yet destroyed
					if (!this.isDestroyed && this.reconnectAttempt < MAX_RECONNECT_ATTEMPTS) {
						this.reconnectAttempt++;
						this.serverIndex++;
						const delay = RECONNECT_BASE_DELAY_MS * Math.pow(1.5, this.reconnectAttempt - 1);
						console.log(`[Signaling] Retrying with next server in ${Math.round(delay)}ms...`);
						setTimeout(() => {
							this.connectWebSocket(shortCode).then(doResolve);
						}, delay);
					} else {
						console.warn("[Signaling] All servers exhausted. Falling back to BroadcastChannel only.");
						doResolve();
					}
				};
			} catch (err) {
				clearTimeout(connectTimeout);
				console.warn("[Signaling] WebSocket creation failed:", err);
				doResolve();
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
