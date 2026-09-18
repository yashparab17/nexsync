// Owns the one PeerJS `Peer` (local WebRTC identity + signaling channel) for
// this app instance, and fans out inbound/outbound DataConnections into
// individual `P2PPeerConnection` wrappers.
//
// This is the fix for the old architecture, where `P2PPeerConnection` created
// its own `Peer` AND held a single `this.conn` for the remote side. A host
// accepting a second guest silently overwrote the first guest's connection,
// so any workspace with more than 2 collaborators was broken. Here, `listen()`
// keeps the `Peer` open indefinitely and wraps every inbound connection
// separately, so N guests can be connected to one host at once.

import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { P2PPeerConnection, type P2PPeerOptions } from "./P2PPeerConnection";

// Default ICE servers. STUN is enough for most direct P2P connections; the
// TURN entry is a free relay for testing only — see the note in the project
// README/PROJECT_GUIDE about self-hosting TURN (e.g. coturn) or using a paid
// relay (Twilio Network Traversal, Cloudflare Calls) before relying on this
// for anyone behind symmetric NAT in production.
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
	{ urls: "stun:stun.l.google.com:19302" },
	{ urls: "stun:global.stun.twilio.com:3478" },
	...(import.meta.env.VITE_TURN_URL
		? [
				{
					urls: import.meta.env.VITE_TURN_URL,
					username: import.meta.env.VITE_TURN_USERNAME ?? "",
					credential: import.meta.env.VITE_TURN_CREDENTIAL ?? "",
				},
			]
		: []),
];

export interface P2PLocalNodeOptions {
	peerId: string;
	peerName: string;
	role?: string;
	iceServers?: RTCIceServer[];
}

type PeerJoinedListener = (peer: P2PPeerConnection) => void;
type PeerLeftListener = (peer: P2PPeerConnection) => void;
type LocalErrorListener = (err: Error) => void;

export class P2PLocalNode {
	private peer: Peer | null = null;
	private connections: Map<string, P2PPeerConnection> = new Map();
	private options: P2PLocalNodeOptions;

	private joinedListeners: Set<PeerJoinedListener> = new Set();
	private leftListeners: Set<PeerLeftListener> = new Set();
	private errorListeners: Set<LocalErrorListener> = new Set();

	// How many *inbound* handshake attempts have failed in a row. Used to
	// throttle a rendezvous ID under active guessing/probing rather than
	// re-verifying at full speed forever.
	private failedHandshakeStreak = 0;

	constructor(options: P2PLocalNodeOptions) {
		this.options = options;
	}

	// Host role: open the local Peer under a specific (deterministic or
	// invite-carried) ID and accept any number of inbound guest connections.
	public async listen(
		localPeerjsId: string,
		codeAuthKey: CryptoKey | null,
	): Promise<void> {
		await this.openPeer(localPeerjsId);

		this.peer!.on("connection", (conn: DataConnection) => {
			this.wrapConnection(conn, codeAuthKey);
		});
	}

	// Guest role: open the local Peer under a random ID and dial a known
	// remote rendezvous ID.
	public async connectTo(
		remotePeerjsId: string,
		codeAuthKey: CryptoKey | null,
	): Promise<P2PPeerConnection> {
		await this.openPeer(undefined);

		const conn = this.peer!.connect(remotePeerjsId, { reliable: true });
		return this.wrapConnection(conn, codeAuthKey);
	}

	private openPeer(explicitId: string | undefined): Promise<void> {
		if (this.peer && !this.peer.destroyed) {
			return Promise.resolve();
		}

		return new Promise((resolve, reject) => {
			const peer = new Peer(explicitId as string, {
				config: { iceServers: this.options.iceServers ?? DEFAULT_ICE_SERVERS },
			});
			this.peer = peer;

			peer.on("open", () => resolve());
			peer.on("error", (err) => {
				this.errorListeners.forEach((l) => l(err));
				// `unavailable-id` means someone already holds this rendezvous ID —
				// either a genuine collision or a squatter. Either way, surface it
				// distinctly so the UI can tell the user to regenerate the code
				// rather than silently retrying forever.
				reject(err);
			});
		});
	}

	private wrapConnection(
		conn: DataConnection,
		codeAuthKey: CryptoKey | null,
	): P2PPeerConnection {
		const peerConnection = new P2PPeerConnection(conn, {
			peerId: this.options.peerId,
			peerName: this.options.peerName,
			role: this.options.role,
			codeAuthKey,
		});

		peerConnection.onStatusChange((status) => {
			if (status === "connected") {
				this.failedHandshakeStreak = 0;
				this.connections.set(conn.peer, peerConnection);
				this.joinedListeners.forEach((l) => l(peerConnection));
			} else if (status === "failed" || status === "disconnected" || status === "closed") {
				if (status === "failed" && codeAuthKey) {
					this.failedHandshakeStreak += 1;
				}
				if (this.connections.get(conn.peer) === peerConnection) {
					this.connections.delete(conn.peer);
					this.leftListeners.forEach((l) => l(peerConnection));
				}
			}
		});

		return peerConnection;
	}

	// Rough client-side throttle: after repeated failed handshakes (wrong-code
	// probes) on a code-protected rendezvous ID, callers can check this before
	// accepting more connection attempts in a tight loop. This does not stop a
	// determined remote attacker (that requires server-side rate limiting we
	// don't control on the public PeerJS broker — see PROJECT notes on
	// self-hosting a signaling server), but it does stop a misbehaving local
	// retry loop from hammering the broker.
	public get suspiciousActivityDetected(): boolean {
		return this.failedHandshakeStreak >= 5;
	}

	public getConnections(): P2PPeerConnection[] {
		return Array.from(this.connections.values());
	}

	public getLocalPeerjsId(): string | null {
		return this.peer?.id ?? null;
	}

	public onPeerJoined(listener: PeerJoinedListener): () => void {
		this.joinedListeners.add(listener);
		return () => this.joinedListeners.delete(listener);
	}

	public onPeerLeft(listener: PeerLeftListener): () => void {
		this.leftListeners.add(listener);
		return () => this.leftListeners.delete(listener);
	}

	public onError(listener: LocalErrorListener): () => void {
		this.errorListeners.add(listener);
		return () => this.errorListeners.delete(listener);
	}

	public close(): void {
		for (const conn of this.connections.values()) {
			conn.close();
		}
		this.connections.clear();
		this.peer?.destroy();
		this.peer = null;
		this.joinedListeners.clear();
		this.leftListeners.clear();
		this.errorListeners.clear();
	}
}

export type { P2PPeerOptions };
