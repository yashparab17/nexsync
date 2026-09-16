// Chunked P2P File Transfer over WebRTC DataChannels with E2EE
// Splits large files and assets into safe 64KB chunks for rapid streaming across peers

import { bytesToBase64Url, base64UrlToBytes } from "@/lib/crypto/e2ee";
import type { P2PPeerConnection } from "./P2PPeerConnection";
import type { P2PMessage, P2PFileHeader } from "./types";

const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk

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

	// Attaches file transfer listeners to a connected peer
	public attachPeer(peer: P2PPeerConnection): () => void {
		return peer.onMessage((message) => {
			this.handleMessage(message, peer);
		});
	}

	// Sends a file in sequential 64KB chunks over the peer's encrypted CRDT/file channel
	public async sendFile(
		peer: P2PPeerConnection,
		file: OutgoingFile,
		onProgress?: (progress: number) => void,
	): Promise<string> {
		const fileId = `file-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
		const totalBytes = file.data.byteLength;
		const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE);

		const header: P2PFileHeader = {
			fileId,
			fileName: file.fileName,
			relPath: file.relPath,
			totalBytes,
			totalChunks,
			mimeType: file.mimeType || "application/octet-stream",
		};

		// 1. Send FILE_START descriptor
		await peer.sendMessage({
			kind: "FILE_START",
			senderId: peer.peerId,
			senderName: peer.peerName,
			timestamp: Date.now(),
			payload: JSON.stringify(header),
		});

		// 2. Transmit each chunk
		for (let i = 0; i < totalChunks; i++) {
			const start = i * CHUNK_SIZE;
			const end = Math.min(start + CHUNK_SIZE, totalBytes);
			const chunkData = file.data.subarray(start, end);
			const chunkBase64 = bytesToBase64Url(chunkData);

			await peer.sendMessage({
				kind: "FILE_CHUNK",
				senderId: peer.peerId,
				senderName: peer.peerName,
				timestamp: Date.now(),
				payload: JSON.stringify({
					fileId,
					chunkIndex: i,
					totalChunks,
					data: chunkBase64,
				}),
			});

			const progress = Math.min(100, Math.round(((i + 1) / totalChunks) * 100));
			if (onProgress) onProgress(progress);
			this.emitProgress(fileId, progress, true);
		}

		// 3. Send FILE_COMPLETE signal
		await peer.sendMessage({
			kind: "FILE_COMPLETE",
			senderId: peer.peerId,
			senderName: peer.peerName,
			timestamp: Date.now(),
			payload: JSON.stringify({ fileId }),
		});

		return fileId;
	}

	// Handles incoming file chunk protocol messages
	private handleMessage(message: P2PMessage, peer: P2PPeerConnection) {
		if (!message.payload) return;

		try {
			switch (message.kind) {
				case "FILE_START": {
					const header: P2PFileHeader = JSON.parse(message.payload);
					this.incomingTransfers.set(header.fileId, {
						header,
						chunks: new Map(),
						receivedBytes: 0,
						startTime: Date.now(),
					});
					this.emitProgress(header.fileId, 0, false);
					break;
				}

				case "FILE_CHUNK": {
					const { fileId, chunkIndex, totalChunks, data } = JSON.parse(message.payload);
					const transfer = this.incomingTransfers.get(fileId);
					if (!transfer) return;

					const chunkBytes = base64UrlToBytes(data);
					transfer.chunks.set(chunkIndex, chunkBytes);
					transfer.receivedBytes += chunkBytes.byteLength;

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

					// Reassemble full file payload
					const totalLen = transfer.header.totalBytes;
					const result = new Uint8Array(totalLen);
					let offset = 0;

					for (let i = 0; i < transfer.header.totalChunks; i++) {
						const chunk = transfer.chunks.get(i);
						if (chunk) {
							result.set(chunk, offset);
							offset += chunk.byteLength;
						}
					}

					this.emitProgress(fileId, 100, false);
					this.incomingTransfers.delete(fileId);

					// Dispatch complete file event
					this.onFileReceivedCallbacks.forEach((cb) => {
						try {
							cb(transfer.header, result, peer);
						} catch (err) {
							console.error("[P2PFileTransfer] Callback error:", err);
						}
					});
					break;
				}

				default:
					break;
			}
		} catch (err) {
			console.error("[P2PFileTransfer] Error handling file chunk message:", err);
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

	private emitProgress(transferId: string, progress: number, isUpload: boolean) {
		this.onProgressCallbacks.forEach((cb) => {
			try {
				cb(transferId, progress, isUpload);
			} catch (err) {
				console.error("[P2PFileTransfer] Error in progress listener:", err);
			}
		});
	}
}
