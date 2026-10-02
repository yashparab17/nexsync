// Real-time Yjs CRDT sync over the P2P message channel: a state-vector exchange per peer, then incremental
// updates, plus an optional awareness (cursor/presence) channel piggybacked on the same peer set.

import * as Y from "yjs";
import {
	Awareness,
	encodeAwarenessUpdate,
	applyAwarenessUpdate,
} from "y-protocols/awareness";
import type { P2PMessage } from "./types";
import { uint8ArrayToBase64 as bytesToBase64, base64ToUint8Array as base64ToBytes } from "@/lib/tauri";

// Sends a message to a single peer
export type SyncSend = (message: P2PMessage, peerId: string) => void;

// Keeps one Y.Doc (and optionally its Awareness presence state) in sync with every connected peer
export class P2PSyncProvider {
	public readonly doc: Y.Doc;
	public readonly docId: string;
	public readonly awareness: Awareness | null;
	private readonly send: SyncSend;
	private peers = new Set<string>();
	// Peers that have answered our request for state at least once
	private answered = new Set<string>();
	private destroyed = false;

	// `onRemoteText` hears of each peer update that changed the note's text, with who sent it
	constructor(
		doc: Y.Doc,
		send: SyncSend,
		docId = "root",
		awareness: Awareness | null = null,
		private readonly onRemoteText?: (docId: string, who: string | null, before: string, after: string) => void,
	) {
		this.doc = doc;
		this.docId = docId;
		this.awareness = awareness;
		this.send = send;
		this.doc.on("update", this.handleLocalUpdate);
		this.awareness?.on("update", this.handleAwarenessUpdate);
	}

	// Starts syncing with a peer by sending our state vector (sync step 1), plus our current
	// presence state so a peer that joins after others are already editing sees their cursors
	public addPeer(peerId: string) {
		if (this.destroyed || this.peers.has(peerId)) return;
		this.peers.add(peerId);
		this.requestState(peerId);
		this.shareAwareness(peerId);
	}

	// Asks a peer for what we are missing (sync step 1)
	private requestState(peerId: string) {
		this.send(
			{
				kind: "SYNC_STEP_1",
				docId: this.docId,
				timestamp: Date.now(),
				payload: bytesToBase64(Y.encodeStateVector(this.doc)),
			},
			peerId,
		);
	}

	// Tells a peer where our cursor and everyone else's we know of are, so one who opens the note later sees them
	private shareAwareness(peerId: string) {
		if (!this.awareness) return;
		const clients = Array.from(this.awareness.getStates().keys());
		if (clients.length === 0) return;
		this.send(
			{
				kind: "AWARENESS_UPDATE",
				docId: this.docId,
				timestamp: Date.now(),
				payload: bytesToBase64(encodeAwarenessUpdate(this.awareness, clients)),
			},
			peerId,
		);
	}

	public removePeer(peerId: string) {
		this.peers.delete(peerId);
		this.answered.delete(peerId);
	}

	// Applies a SYNC_*/AWARENESS_UPDATE message from a peer; other kinds and other documents are ignored
	public handleMessage(peerId: string, message: P2PMessage) {
		if (this.destroyed || !this.peers.has(peerId) || !message.payload) return;
		if ((message.docId ?? "root") !== this.docId) return;

		try {
			if (message.kind === "SYNC_STEP_1") {
				// Reply with whatever the peer is missing (sync step 2)
				const remoteStateVector = base64ToBytes(message.payload);
				this.send(
					{
						kind: "SYNC_STEP_2",
						docId: this.docId,
						timestamp: Date.now(),
						payload: bytesToBase64(Y.encodeStateAsUpdate(this.doc, remoteStateVector)),
					},
					peerId,
				);
				// A request that reaches us means the peer's editor has just opened, so whatever we asked of it before
				// was lost. Ask again, and show them where our cursor is. Once they have answered us there is nothing
				// left to ask, which is what stops the two from asking each other for ever.
				if (!this.answered.has(peerId)) this.requestState(peerId);
				this.shareAwareness(peerId);
			} else if (message.kind === "SYNC_STEP_2" || message.kind === "SYNC_UPDATE") {
				if (message.kind === "SYNC_STEP_2") this.answered.add(peerId);
				// Origin = this provider, so the update isn't echoed back out
				const text = this.doc.getText("content");
				const before = this.onRemoteText ? text.toString() : "";
				Y.applyUpdate(this.doc, base64ToBytes(message.payload), this);
				// A catch-up answer holds what several people wrote, so it is not credited to the one who sent it
				this.onRemoteText?.(this.docId, message.kind === "SYNC_UPDATE" ? (message.author ?? null) : null, before, text.toString());
			} else if (message.kind === "AWARENESS_UPDATE" && this.awareness) {
				applyAwarenessUpdate(this.awareness, base64ToBytes(message.payload), this);
			}
		} catch (err) {
			console.error(`[P2PSyncProvider] Failed to apply ${message.kind} for ${this.docId}:`, err);
		}
	}

	// Broadcasts local edits to every synced peer
	private handleLocalUpdate = (update: Uint8Array, origin: unknown) => {
		if (origin === this || this.destroyed || this.peers.size === 0) return;
		const message: P2PMessage = {
			kind: "SYNC_UPDATE",
			docId: this.docId,
			timestamp: Date.now(),
			payload: bytesToBase64(update),
		};
		this.peers.forEach((peerId) => this.send(message, peerId));
	};

	// Broadcasts local cursor/presence changes to every synced peer (remote-applied changes aren't re-broadcast)
	private handleAwarenessUpdate = (
		{ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
		origin: unknown,
	) => {
		if (origin === this || this.destroyed || this.peers.size === 0 || !this.awareness) return;
		const changed = added.concat(updated, removed);
		if (changed.length === 0) return;
		const message: P2PMessage = {
			kind: "AWARENESS_UPDATE",
			docId: this.docId,
			timestamp: Date.now(),
			payload: bytesToBase64(encodeAwarenessUpdate(this.awareness, changed)),
		};
		this.peers.forEach((peerId) => this.send(message, peerId));
	};

	public destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.doc.off("update", this.handleLocalUpdate);
		this.awareness?.off("update", this.handleAwarenessUpdate);
		this.peers.clear();
	}
}
