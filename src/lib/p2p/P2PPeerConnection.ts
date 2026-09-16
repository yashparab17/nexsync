// WebRTC Peer Connection wrapper with automated E2EE frame encryption
// Establishes encrypted DataChannels for real-time Yjs CRDT synchronization and file streaming

import {
	encryptPayload,
	decryptPayloadToString,
	exportRawKey,
	importRawKey,
	deriveKeyFromShortCode,
	bytesToBase64Url,
	base64UrlToBytes,
} from "@/lib/crypto/e2ee";
import { P2PSignaling } from "./P2PSignaling";
import type {
	P2PMessage,
	PeerConnectionStatus,
	ConnectedPeerInfo,
	InvitePayload,
	AnswerPayload,
} from "./types";

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
	// STUN servers — used for NAT traversal (works on simple NATs)
	{ urls: "stun:stun.l.google.com:19302" },
	{ urls: "stun:stun1.l.google.com:19302" },
	{ urls: "stun:global.stun.twilio.com:3478" },
	// TURN relay servers — required for symmetric NAT, firewalls, mobile networks (~40% of peers)
	// Using OpenRelay (Metered.ca) — free, public, always-on
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
];

export interface P2PPeerOptions {
	peerId: string;
	peerName: string;
	role?: string;
	iceServers?: RTCIceServer[];
}

type MessageListener = (msg: P2PMessage, peer: P2PPeerConnection) => void;
type StatusListener = (
	status: PeerConnectionStatus,
	peer: P2PPeerConnection,
) => void;

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

	private pc: RTCPeerConnection;
	private crdtChannel: RTCDataChannel | null = null;
	private fileChannel: RTCDataChannel | null = null;
	private e2eeKey: CryptoKey | null = null;
	private signaling: P2PSignaling | null = null;

	private messageListeners: Set<MessageListener> = new Set();
	private statusListeners: Set<StatusListener> = new Set();
	private pingInterval: ReturnType<typeof setInterval> | null = null;

	constructor(options: P2PPeerOptions) {
		this.peerId = options.peerId;
		this.peerName = options.peerName;
		this.role = options.role ?? "Editor";

		this.pc = new RTCPeerConnection({
			iceServers: options.iceServers ?? DEFAULT_ICE_SERVERS,
		});

		this.setupPcListeners();
	}

	// Attach RTCPeerConnection lifecycle handlers
	private setupPcListeners() {
		this.pc.onconnectionstatechange = () => {
			const state = this.pc.connectionState as PeerConnectionStatus;
			this.setStatus(state);
			if (state === "connected") {
				this.connectedAt = Date.now();
				this.startPingMonitor();
				this.signaling?.disconnect();
			} else if (
				state === "disconnected" ||
				state === "closed" ||
				state === "failed"
			) {
				this.stopPingMonitor();
			}
		};

		// Monitor ICE connection state separately — surfaces "failed" earlier than connectionState
		this.pc.oniceconnectionstatechange = () => {
			const iceState = this.pc.iceConnectionState;
			console.log(`[P2P] ICE connection state: ${iceState}`);
			if (iceState === "failed") {
				console.error("[P2P] ICE negotiation failed. Check STUN/TURN reachability.");
				this.setStatus("failed");
				this.stopPingMonitor();
			} else if (iceState === "disconnected") {
				// Transient disconnection — WebRTC may recover automatically
				console.warn("[P2P] ICE disconnected (may recover automatically).");
			}
		};

		this.pc.onicegatheringstatechange = () => {
			console.log(`[P2P] ICE gathering state: ${this.pc.iceGatheringState}`);
		};

		this.pc.ondatachannel = (event) => {
			const channel = event.channel;
			if (channel.label === "crdt-sync") {
				this.crdtChannel = channel;
				this.setupDataChannel(channel);
			} else if (channel.label === "file-transfer") {
				this.fileChannel = channel;
				this.setupDataChannel(channel);
			}
		};
	}

	// Configure DataChannel message and state handlers
	private setupDataChannel(channel: RTCDataChannel) {
		channel.binaryType = "arraybuffer";

		channel.onopen = () => {
			if (this.crdtChannel?.readyState === "open") {
				this.setStatus("connected");
			}
		};

		channel.onmessage = async (event) => {
			try {
				let rawBytes: Uint8Array;
				if (event.data instanceof ArrayBuffer) {
					rawBytes = new Uint8Array(event.data);
				} else if (typeof event.data === "string") {
					rawBytes = new TextEncoder().encode(event.data);
				} else {
					return;
				}

				this.bytesReceived += rawBytes.byteLength;

				// Decrypt E2EE frame if key is active
				let messageJson: string;
				if (this.e2eeKey) {
					messageJson = await decryptPayloadToString(
						rawBytes,
						this.e2eeKey,
					);
				} else {
					messageJson = new TextDecoder().decode(rawBytes);
				}

				const message: P2PMessage = JSON.parse(messageJson);

				// Handle internal ping-pong
				if (message.kind === "PING") {
					this.sendMessage({
						kind: "PONG",
						senderId: this.peerId,
						senderName: this.peerName,
						timestamp: message.timestamp,
					});
					return;
				}
				if (message.kind === "PONG") {
					this.latencyMs = Math.max(
						0,
						Date.now() - message.timestamp,
					);
					return;
				}

				// Dispatch to subscribers
				this.messageListeners.forEach((listener) => {
					try {
						listener(message, this);
					} catch (err) {
						console.error("[P2P] Error in message listener:", err);
					}
				});
			} catch (err) {
				console.error("[P2P] Failed to process incoming message:", err);
			}
		};
	}

	// Set or update the active E2EE symmetric key
	public setE2eeKey(key: CryptoKey) {
		this.e2eeKey = key;
	}

	// ────────────────────────────
	// 1-Code Automated Signaling Flow
	// ────────────────────────────

	// Host creates room with a short 6-character code (e.g. NX-4921) and auto-negotiates in background
	public async hostWithShortCode(
		shortCode: string,
		workspaceId: string,
		workspaceName: string,
	): Promise<string> {
		const key = await deriveKeyFromShortCode(shortCode);
		this.setE2eeKey(key);

		// Setup DataChannels
		this.crdtChannel = this.pc.createDataChannel("crdt-sync", {
			ordered: true,
		});
		this.setupDataChannel(this.crdtChannel);

		this.fileChannel = this.pc.createDataChannel("file-transfer", {
			ordered: true,
		});
		this.setupDataChannel(this.fileChannel);

		const offer = await this.pc.createOffer();
		await this.pc.setLocalDescription(offer);
		await this.waitForIceGathering();

		// Connect to signaling room
		this.signaling = new P2PSignaling(this.peerId);
		await this.signaling.connect(shortCode);

		const offerPayload = {
			sdp: this.pc.localDescription ?? offer,
			workspaceId,
			workspaceName,
			hostPeerId: this.peerId,
			hostPeerName: this.peerName,
		};

		// Broadcast offer into the encrypted rendezvous room
		await this.signaling.send("offer", offerPayload);

		// Periodically broadcast offer until peer answers
		const broadcastInterval = setInterval(async () => {
			if (this.status === "connected" || !this.signaling) {
				clearInterval(broadcastInterval);
				return;
			}
			await this.signaling.send("offer", offerPayload);
		}, 3000);

		// Listen for peer join requests or answers
		this.signaling.onMessage(async (msg) => {
			if (msg.type === "request_offer") {
				await this.signaling?.send("offer", offerPayload);
			} else if (msg.type === "answer" && msg.payload?.sdp) {
				clearInterval(broadcastInterval);
				this.remotePeerId = msg.senderId;
				this.remotePeerName =
					msg.payload.joinerPeerName || "Collaborator";
				try {
					await this.pc.setRemoteDescription(
						new RTCSessionDescription(msg.payload.sdp),
					);
				} catch (err) {
					console.warn("[P2P] Remote description set:", err);
				}
			}
		});

		return shortCode;
	}

	// Guest joins using only the short code and auto-negotiates
	public async joinWithShortCode(shortCode: string): Promise<{
		workspaceId: string;
		workspaceName: string;
	}> {
		const key = await deriveKeyFromShortCode(shortCode);
		this.setE2eeKey(key);

		this.signaling = new P2PSignaling(this.peerId);

		// IMPORTANT: Register onMessage BEFORE connecting & sending request_offer.
		// This prevents a race condition where the host's broadcast offer arrives
		// before the listener is set up, causing it to be silently dropped.
		const handshakePromise = new Promise<{
			workspaceId: string;
			workspaceName: string;
		}>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(
					new Error(
						"Connection timed out. Please verify the 6-character code and ensure the host is online.",
					),
				);
			}, 30000); // Extended to 30s to account for TURN relay negotiation time

			let offerHandled = false;

			this.signaling!.onMessage(async (msg) => {
				if (msg.type === "offer" && msg.payload?.sdp && !offerHandled) {
					offerHandled = true;
					clearTimeout(timeout);
					try {
						const offerPayload = msg.payload;
						this.remotePeerId =
							offerPayload.hostPeerId || msg.senderId;
						this.remotePeerName =
							offerPayload.hostPeerName || "Host";

						await this.pc.setRemoteDescription(
							new RTCSessionDescription(offerPayload.sdp),
						);

						const answer = await this.pc.createAnswer();
						await this.pc.setLocalDescription(answer);
						await this.waitForIceGathering();

						// Send answer back to host over encrypted signaling
						await this.signaling?.send("answer", {
							sdp: this.pc.localDescription ?? answer,
							joinerPeerId: this.peerId,
							joinerPeerName: this.peerName,
						});

						resolve({
							workspaceId:
								offerPayload.workspaceId || "synced-workspace",
							workspaceName:
								offerPayload.workspaceName ||
								"Synced Workspace",
						});
					} catch (err) {
						reject(err);
					}
				}
			});
		});

		// Now connect and request offer AFTER listener is registered
		await this.signaling.connect(shortCode);

		// Request offer from host. If host is already broadcasting, onMessage will catch it.
		this.signaling.send("request_offer", {
			joinerPeerId: this.peerId,
			joinerPeerName: this.peerName,
		});

		return handshakePromise;
	}

	// ────────────────────────────
	// Manual Handshake (Fallback Support)
	// ────────────────────────────

	public async createHostInvite(
		workspaceId: string,
		workspaceName: string,
		e2eeKey: CryptoKey,
	): Promise<string> {
		this.setE2eeKey(e2eeKey);

		this.crdtChannel = this.pc.createDataChannel("crdt-sync", {
			ordered: true,
		});
		this.setupDataChannel(this.crdtChannel);

		this.fileChannel = this.pc.createDataChannel("file-transfer", {
			ordered: true,
		});
		this.setupDataChannel(this.fileChannel);

		const offer = await this.pc.createOffer();
		await this.pc.setLocalDescription(offer);
		await this.waitForIceGathering();

		const rawKey = await exportRawKey(e2eeKey);
		const e2eeKeyBase64 = bytesToBase64Url(rawKey);

		const invite: InvitePayload = {
			workspaceId,
			workspaceName,
			hostPeerId: this.peerId,
			hostPeerName: this.peerName,
			role: this.role,
			e2eeKey: e2eeKeyBase64,
			sdpOffer: this.pc.localDescription ?? offer,
			created: Date.now(),
		};

		return bytesToBase64Url(
			new TextEncoder().encode(JSON.stringify(invite)),
		);
	}

	public async acceptAnswer(answerCode: string): Promise<void> {
		try {
			const decoded = new TextDecoder().decode(
				base64UrlToBytes(answerCode.trim()),
			);
			const answerPayload: AnswerPayload = JSON.parse(decoded);

			this.remotePeerId = answerPayload.joinerPeerId;
			this.remotePeerName = answerPayload.joinerPeerName;

			await this.pc.setRemoteDescription(
				new RTCSessionDescription(answerPayload.sdpAnswer),
			);
		} catch (err) {
			throw new Error(`Invalid answer code: ${err}`);
		}
	}

	public async joinFromInvite(inviteCode: string): Promise<{
		workspaceId: string;
		workspaceName: string;
		answerCode: string;
	}> {
		try {
			const decoded = new TextDecoder().decode(
				base64UrlToBytes(inviteCode.trim()),
			);
			const invite: InvitePayload = JSON.parse(decoded);

			this.remotePeerId = invite.hostPeerId;
			this.remotePeerName = invite.hostPeerName;

			const rawKey = base64UrlToBytes(invite.e2eeKey);
			const importedKey = await importRawKey(rawKey);
			this.setE2eeKey(importedKey);

			if (invite.sdpOffer) {
				await this.pc.setRemoteDescription(
					new RTCSessionDescription(invite.sdpOffer),
				);
			} else {
				throw new Error("Invite code is missing SDP offer.");
			}

			const answer = await this.pc.createAnswer();
			await this.pc.setLocalDescription(answer);

			await this.waitForIceGathering();

			const answerPayload: AnswerPayload = {
				joinerPeerId: this.peerId,
				joinerPeerName: this.peerName,
				sdpAnswer: this.pc.localDescription ?? answer,
				created: Date.now(),
			};

			const answerCode = bytesToBase64Url(
				new TextEncoder().encode(JSON.stringify(answerPayload)),
			);

			return {
				workspaceId: invite.workspaceId,
				workspaceName: invite.workspaceName,
				answerCode,
			};
		} catch (err) {
			throw new Error(`Failed to process invite code: ${err}`);
		}
	}

	private waitForIceGathering(): Promise<void> {
		if (this.pc.iceGatheringState === "complete") {
			return Promise.resolve();
		}

		// Increased from 2500ms: Linux + TURN relay servers need up to 8s to gather all candidates.
		// Sending an offer/answer with incomplete candidates causes ICE to stall in 'checking' state.
		const ICE_GATHERING_TIMEOUT_MS = 8000;

		return new Promise((resolve) => {
			const checkState = () => {
				if (this.pc.iceGatheringState === "complete") {
					this.pc.removeEventListener(
						"icegatheringstatechange",
						checkState,
					);
					resolve();
				}
			};
			this.pc.addEventListener("icegatheringstatechange", checkState);
			setTimeout(() => {
				this.pc.removeEventListener(
					"icegatheringstatechange",
					checkState,
				);
				console.warn(`[P2P] ICE gathering timed out after ${ICE_GATHERING_TIMEOUT_MS}ms — proceeding with available candidates.`);
				resolve();
			}, ICE_GATHERING_TIMEOUT_MS);
		});
	}

	// ────────────────────────────
	// Messaging & Transmission
	// ────────────────────────────

	public async sendMessage(message: P2PMessage): Promise<void> {
		if (!this.crdtChannel || this.crdtChannel.readyState !== "open") {
			return;
		}

		try {
			const messageJson = JSON.stringify(message);
			let payload: Uint8Array;

			if (this.e2eeKey) {
				payload = await encryptPayload(messageJson, this.e2eeKey);
			} else {
				payload = new TextEncoder().encode(messageJson);
			}

			this.crdtChannel.send(payload.buffer as ArrayBuffer);
			this.bytesSent += payload.byteLength;
		} catch (err) {
			console.error("[P2P] Failed to send encrypted frame:", err);
		}
	}

	public async sendFileFrame(data: Uint8Array): Promise<void> {
		if (!this.fileChannel || this.fileChannel.readyState !== "open") {
			return;
		}

		try {
			let payload: Uint8Array;
			if (this.e2eeKey) {
				payload = await encryptPayload(data, this.e2eeKey);
			} else {
				payload = data;
			}

			this.fileChannel.send(payload.buffer as ArrayBuffer);
			this.bytesSent += payload.byteLength;
		} catch (err) {
			console.error("[P2P] Failed to send file frame:", err);
		}
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
			if (this.crdtChannel?.readyState === "open") {
				this.sendMessage({
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

	public close() {
		this.stopPingMonitor();
		this.signaling?.disconnect();
		this.crdtChannel?.close();
		this.fileChannel?.close();
		this.pc.close();
		this.setStatus("closed");
		this.messageListeners.clear();
		this.statusListeners.clear();
	}
}
