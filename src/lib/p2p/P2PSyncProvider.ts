// Yjs Real-Time Synchronization Provider over P2P WebRTC DataChannels
// Broadcasts and receives incremental CRDT diffs and handles two-step synchronization

import * as Y from "yjs";
import { bytesToBase64Url, base64UrlToBytes } from "@/lib/crypto/e2ee";
import type { P2PPeerConnection } from "./P2PPeerConnection";
import type { P2PMessage } from "./types";

export interface P2PSyncProviderOptions {
	docId?: string; // Optional document identifier (e.g. note or file path)
}

// Manages real-time Yjs CRDT synchronization across active P2P peer connections
export class P2PSyncProvider {
	public readonly doc: Y.Doc;
	public readonly docId: string;
	private peers: Set<P2PPeerConnection> = new Set();
	private messageUnsubscribers: Map<P2PPeerConnection, () => void> = new Map();
	private isDestroyed: boolean = false;

	constructor(
		doc: Y.Doc,
		options: P2PSyncProviderOptions = {},
	) {
		this.doc = doc;
		this.docId = options.docId ?? "root";

		// Listen to local document updates and broadcast to peers
		this.doc.on("update", this.handleLocalDocUpdate);
	}

	// Register an active P2P peer connection for synchronization
	public addPeer(peer: P2PPeerConnection) {
		if (this.peers.has(peer) || this.isDestroyed) return;

		this.peers.add(peer);

		// Subscribe to incoming messages from this peer
		const unsubMessage = peer.onMessage((message) => {
			this.handlePeerMessage(message, peer);
		});
		this.messageUnsubscribers.set(peer, unsubMessage);

		// Trigger Sync Step 1: Send our local state vector
		this.sendSyncStep1(peer);
	}

	// Remove a peer connection from synchronization
	public removePeer(peer: P2PPeerConnection) {
		this.peers.delete(peer);
		const unsub = this.messageUnsubscribers.get(peer);
		if (unsub) {
			unsub();
			this.messageUnsubscribers.delete(peer);
		}
	}

	// Initiates Step 1 of Yjs sync: sends state vector to peer
	private sendSyncStep1(peer: P2PPeerConnection) {
		if (this.isDestroyed) return;

		const stateVector = Y.encodeStateVector(this.doc);
		const stateVectorBase64 = bytesToBase64Url(stateVector);

		peer.sendMessage({
			kind: "SYNC_STEP_1",
			docId: this.docId,
			senderId: peer.peerId,
			senderName: peer.peerName,
			timestamp: Date.now(),
			payload: stateVectorBase64,
		});
	}

	// Handles incoming P2P CRDT sync messages
	private handlePeerMessage(message: P2PMessage, peer: P2PPeerConnection) {
		if (this.isDestroyed) return;
		if (message.docId && message.docId !== this.docId) return;

		try {
			switch (message.kind) {
				case "SYNC_STEP_1": {
					// Peer sent their state vector; calculate missing updates from our doc and send back (Step 2)
					if (!message.payload) return;
					const remoteStateVector = base64UrlToBytes(message.payload);
					const update = Y.encodeStateAsUpdate(this.doc, remoteStateVector);
					const updateBase64 = bytesToBase64Url(update);

					peer.sendMessage({
						kind: "SYNC_STEP_2",
						docId: this.docId,
						senderId: peer.peerId,
						senderName: peer.peerName,
						timestamp: Date.now(),
						payload: updateBase64,
					});
					break;
				}

				case "SYNC_STEP_2":
				case "SYNC_UPDATE": {
					// Peer sent missing document state or incremental edit
					if (!message.payload) return;
					const update = base64UrlToBytes(message.payload);
					if (update.length > 0) {
						// Apply using this provider as origin so we do not bounce it back to peers
						Y.applyUpdate(this.doc, update, this);
					}
					break;
				}

				default:
					break;
			}
		} catch (err) {
			console.error(`[P2PSyncProvider] Error handling sync message (${message.kind}):`, err);
		}
	}

	// Handles local Yjs updates and broadcasts them to all connected peers
	private handleLocalDocUpdate = (update: Uint8Array, origin: unknown) => {
		// Ignore updates applied from remote peers or internal sync
		if (origin === this || this.isDestroyed || this.peers.size === 0) {
			return;
		}

		const updateBase64 = bytesToBase64Url(update);
		const message: P2PMessage = {
			kind: "SYNC_UPDATE",
			docId: this.docId,
			senderId: "local",
			senderName: "local",
			timestamp: Date.now(),
			payload: updateBase64,
		};

		this.peers.forEach((peer) => {
			peer.sendMessage(message);
		});
	};

	// Disconnects provider, unbinds update listeners, and clears peers
	public destroy() {
		if (this.isDestroyed) return;
		this.isDestroyed = true;

		this.doc.off("update", this.handleLocalDocUpdate);

		this.messageUnsubscribers.forEach((unsub) => unsub());
		this.messageUnsubscribers.clear();
		this.peers.clear();
	}
}
