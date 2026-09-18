// Chunked P2P File Transfer over encrypted WebRTC DataChannels.
//
// Fixes over the previous version:
//  - Backpressure: chunks used to be fired in a tight loop with no regard for
//    the underlying RTCDataChannel's buffered amount, which could balloon
//    memory/queue depth without bound on a large file over a slow link. We
//    now pause and wait for the buffer to drain before sending more.
//  - Integrity: `P2PFileHeader.sha256` existed in the type but was never
//    populated or checked. A file is now hashed before sending and
//    re-hashed after reassembly; a mismatch is reported as an error instead
//    of silently handing corrupted bytes to the caller.
//  - Missing chunks used to be silently skipped, leaving zero-filled gaps in
//    the reassembled file. A short/incomplete transfer is now treated as a
//    failure.
//  - Stale transfers (peer disconnects mid-transfer, or a chunk is dropped
//    and FILE_COMPLETE never arrives) used to accumulate forever in memory.
//    A sweep now expires transfers that go quiet for too long.

import { bytesToBase64Url, base64UrlToBytes } from "@/lib/crypto/e2ee";
import type { P2PPeerConnection } from "./P2PPeerConnection";
import type { P2PMessage, P2PFileHeader } from "./types";

const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk
const MAX_FILE_BYTES = 512 * 1024 * 1024; // 512 MB cap per transfer
const HIGH_WATER_MARK = 4 * 1024 * 1024; // Pause sending above 4 MB buffered
const LOW_WATER_MARK = 1 * 1024 * 1024; // Resume sending below 1 MB buffered
const STALE_TRANSFER_MS = 60_000; // Drop an incoming transfer idle this long
const SWEEP_INTERVAL_MS = 15_000;

export interface OutgoingFile {
	fileName: string;
	relPath: string;
	data: Uint8Array;
	mimeType?: string;
}

export interface IncomingTransfer {
	header: P2PFileHeader;
	chunks: Map<number, Uint8Array>;
	receivedBytes: number;
	startTime: number;
	lastActivityAt: number;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
	const digest = await window.crypto.subtle.digest("SHA-256", data as unknown as BufferSource);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

// Waits until the peer's underlying DataChannel buffer has drained enough to
// accept more data, so a large file transfer can't grow the channel's
// internal queue without bound.
async function waitForBufferDrain(peer: P2PPeerConnection): Promise<void> {
	if (peer.bufferedAmount < HIGH_WATER_MARK) return;
	await new Promise<void>((resolve) => {
		const check = () => {
			if (!peer.isOpen() || peer.bufferedAmount < LOW_WATER_MARK) {
				resolve();
				return;
			}
			setTimeout(check, 25);
		};
		check();
	});
}

// Manages chunked streaming of files and assets across P2P peers
export class P2PFileTransfer {
	private incomingTransfers: Map<string, IncomingTransfer> = new Map();
	private onFileReceivedCallbacks: Set<
		(header: P2PFileHeader, data: Uint8Array, peer: P2PPeerConnection) => void
	> = new Set();
	private onProgressCallbacks: Set<
		(transferId: string, progress: number, isUpload: boolean) => void
	> = new Set();
	private onErrorCallbacks: Set<(fileId: string, message: string) => void> = new Set();
	private sweepTimer: ReturnType<typeof setInterval>;

	constructor() {
		this.sweepTimer = setInterval(() => this.sweepStaleTransfers(), SWEEP_INTERVAL_MS);
	}

	// Attaches file transfer listeners to a connected peer
	public attachPeer(peer: P2PPeerConnection): () => void {
		return peer.onMessage((message) => {
			void this.handleMessage(message, peer);
		});
	}

	// Sends a file in sequential 64KB chunks over the peer's encrypted channel,
	// pausing when the underlying DataChannel buffer backs up.
	public async sendFile(
		peer: P2PPeerConnection,
		file: OutgoingFile,
		onProgress?: (progress: number) => void,
	): Promise<string> {
		const fileId = `file-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
		const totalBytes = file.data.byteLength;

		if (totalBytes > MAX_FILE_BYTES) {
			throw new Error(
				`File exceeds the ${(MAX_FILE_BYTES / (1024 * 1024)).toFixed(0)} MB P2P transfer limit.`,
			);
		}

		const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE) || 1;
		const sha256 = await sha256Hex(file.data);

		const header: P2PFileHeader = {
			fileId,
			fileName: file.fileName,
			relPath: file.relPath,
			totalBytes,
			totalChunks,
			mimeType: file.mimeType || "application/octet-stream",
			sha256,
		};

		await peer.sendMessage({
			kind: "FILE_START",
			senderId: peer.peerId,
			senderName: peer.peerName,
			timestamp: Date.now(),
			payload: JSON.stringify(header),
		});

		for (let i = 0; i < totalChunks; i++) {
			await waitForBufferDrain(peer);
			if (!peer.isOpen()) {
				throw new Error("Peer disconnected during file transfer.");
			}

			const start = i * CHUNK_SIZE;
			const end = Math.min(start + CHUNK_SIZE, totalBytes);
			const chunkData = file.data.subarray(start, end);

			await peer.sendMessage({
				kind: "FILE_CHUNK",
				senderId: peer.peerId,
				senderName: peer.peerName,
				timestamp: Date.now(),
				payload: JSON.stringify({
					fileId,
					chunkIndex: i,
					totalChunks,
					data: bytesToBase64Url(chunkData),
				}),
			});

			const progress = Math.min(100, Math.round(((i + 1) / totalChunks) * 100));
			onProgress?.(progress);
			this.emitProgress(fileId, progress, true);
		}

		await peer.sendMessage({
			kind: "FILE_COMPLETE",
			senderId: peer.peerId,
			senderName: peer.peerName,
			timestamp: Date.now(),
			payload: JSON.stringify({ fileId }),
		});

		return fileId;
	}

	private async handleMessage(message: P2PMessage, peer: P2PPeerConnection) {
		if (!message.payload) return;

		try {
			switch (message.kind) {
				case "FILE_START": {
					const header: P2PFileHeader = JSON.parse(message.payload);
					if (
						typeof header.totalBytes !== "number" ||
						typeof header.totalChunks !== "number" ||
						header.totalBytes < 0 ||
						header.totalChunks <= 0 ||
						header.totalBytes > MAX_FILE_BYTES
					) {
						this.emitError(header.fileId ?? "unknown", "Rejected file with invalid header.");
						return;
					}
					this.incomingTransfers.set(header.fileId, {
						header,
						chunks: new Map(),
						receivedBytes: 0,
						startTime: Date.now(),
						lastActivityAt: Date.now(),
					});
					this.emitProgress(header.fileId, 0, false);
					break;
				}

				case "FILE_CHUNK": {
					const { fileId, chunkIndex, totalChunks, data } = JSON.parse(message.payload);
					const transfer = this.incomingTransfers.get(fileId);
					if (!transfer) return; // Unknown/expired transfer — ignore rather than throw.

					const chunkBytes = base64UrlToBytes(data);
					transfer.receivedBytes += chunkBytes.byteLength;
					transfer.lastActivityAt = Date.now();

					if (transfer.receivedBytes > transfer.header.totalBytes + CHUNK_SIZE) {
						// Peer is sending far more data than it declared — abort rather
						// than let memory grow unbounded.
						this.incomingTransfers.delete(fileId);
						this.emitError(fileId, "Transfer exceeded its declared size; aborted.");
						return;
					}

					transfer.chunks.set(chunkIndex, chunkBytes);

					const progress = Math.min(
						100,
						Math.round((transfer.chunks.size / totalChunks) * 100),
					);
					this.emitProgress(fileId, progress, false);
					break;
				}

				case "FILE_COMPLETE": {
					const { fileId } = JSON.parse(message.payload);
					const transfer = this.incomingTransfers.get(fileId);
					if (!transfer) return;
					await this.finalizeTransfer(fileId, transfer, peer);
					break;
				}

				default:
					break;
			}
		} catch (err) {
			console.error("[P2PFileTransfer] Error handling file chunk message:", err);
		}
	}

	private async finalizeTransfer(
		fileId: string,
		transfer: IncomingTransfer,
		peer: P2PPeerConnection,
	) {
		this.incomingTransfers.delete(fileId);

		if (transfer.chunks.size !== transfer.header.totalChunks) {
			this.emitError(
				fileId,
				`Incomplete transfer: received ${transfer.chunks.size}/${transfer.header.totalChunks} chunks.`,
			);
			return;
		}

		const result = new Uint8Array(transfer.header.totalBytes);
		let offset = 0;
		for (let i = 0; i < transfer.header.totalChunks; i++) {
			const chunk = transfer.chunks.get(i);
			if (!chunk) {
				// Should be unreachable given the size check above, but never
				// silently zero-fill a gap in file content.
				this.emitError(fileId, `Missing chunk ${i}; aborting reassembly.`);
				return;
			}
			result.set(chunk, offset);
			offset += chunk.byteLength;
		}

		if (transfer.header.sha256) {
			const actualHash = await sha256Hex(result);
			if (actualHash !== transfer.header.sha256) {
				this.emitError(fileId, "Checksum mismatch; discarding corrupted transfer.");
				return;
			}
		}

		this.emitProgress(fileId, 100, false);
		this.onFileReceivedCallbacks.forEach((cb) => {
			try {
				cb(transfer.header, result, peer);
			} catch (err) {
				console.error("[P2PFileTransfer] Callback error:", err);
			}
		});
	}

	private sweepStaleTransfers() {
		const now = Date.now();
		for (const [fileId, transfer] of this.incomingTransfers) {
			if (now - transfer.lastActivityAt > STALE_TRANSFER_MS) {
				this.incomingTransfers.delete(fileId);
				this.emitError(fileId, "Transfer timed out and was discarded.");
			}
		}
	}

	// Subscribe to completely received and reassembled files
	public onFileReceived(
		callback: (header: P2PFileHeader, data: Uint8Array, peer: P2PPeerConnection) => void,
	): () => void {
		this.onFileReceivedCallbacks.add(callback);
		return () => {
			this.onFileReceivedCallbacks.delete(callback);
		};
	}

	// Subscribe to upload/download transfer progress
	public onProgress(
		callback: (transferId: string, progress: number, isUpload: boolean) => void,
	): () => void {
		this.onProgressCallbacks.add(callback);
		return () => {
			this.onProgressCallbacks.delete(callback);
		};
	}

	// Subscribe to transfer failures (rejected, timed out, or corrupted)
	public onError(callback: (fileId: string, message: string) => void): () => void {
		this.onErrorCallbacks.add(callback);
		return () => {
			this.onErrorCallbacks.delete(callback);
		};
	}

	private emitProgress(transferId: string, progress: number, isUpload: boolean) {
		this.onProgressCallbacks.forEach((cb) => {
			try {
				cb(transferId, progress, isUpload);
			} catch (err) {
				console.error("[P2PFileTransfer] Error in progress listener:", err);
			}
		});
	}

	private emitError(fileId: string, message: string) {
		console.warn(`[P2PFileTransfer] ${fileId}: ${message}`);
		this.onErrorCallbacks.forEach((cb) => {
			try {
				cb(fileId, message);
			} catch (err) {
				console.error("[P2PFileTransfer] Error in error listener:", err);
			}
		});
	}

	// Stops the stale-transfer sweep. Call when tearing down the P2P session.
	public destroy() {
		clearInterval(this.sweepTimer);
		this.incomingTransfers.clear();
		this.onFileReceivedCallbacks.clear();
		this.onProgressCallbacks.clear();
		this.onErrorCallbacks.clear();
	}
}
