// Global P2P WebRTC Context providing decentralized mesh management, E2EE synchronization, and lazy on-demand asset transfers

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";
import {
	base64UrlToBytes,
	bytesToBase64Url,
	generateShortCode,
	deriveHostRendezvousId,
	deriveCodeAuthKey,
} from "@/lib/crypto/e2ee";
import {
	P2PPeerConnection,
	P2PLocalNode,
	P2PSyncProvider,
	P2PFileTransfer,
	type ConnectedPeerInfo,
	type P2PMessage,
	type WorkspaceSyncSnapshot,
	type WorkspaceSyncFileItem,
} from "@/lib/p2p";
import { useWorkspace, subscribeToActivityEvents } from "@/store/workspace/WorkspaceContext";
import {
	readWorkspaceMetadata,
	writeWorkspaceMetadata,
	getTasks,
	createTask,
	getKanban,
	createKanbanColumn,
	createKanbanCard,
	listWorkspaceFiles,
	readWorkspaceFile,
	writeWorkspaceFile,
	readWorkspaceBinaryFile,
	writeWorkspaceBinaryFile,
} from "@/lib/tauri";

// 10 MB threshold: files above this size are indexed as lazy placeholders rather than transferred in initial sync
export const LAZY_LOAD_THRESHOLD_BYTES = 10 * 1024 * 1024;

export interface PlaceholderItem {
	relPath: string;
	name: string;
	size: number;
}

interface P2PContextType {
	peers: ConnectedPeerInfo[];
	connectionStatus: "offline" | "connecting" | "connected";
	placeholders: PlaceholderItem[];
	createShortCodeInvite: (role?: string) => Promise<{ shortCode: string }>;
	joinWithShortCode: (shortCode: string) => Promise<{
		workspaceId: string;
		workspaceName: string;
		peer: P2PPeerConnection;
	}>;
	createSyncProvider: (doc: Y.Doc, docId?: string) => P2PSyncProvider;
	fileTransfer: P2PFileTransfer;
	requestWorkspaceSnapshot: (peer?: P2PPeerConnection) => Promise<void>;
	downloadFileOnDemand: (relPath: string) => Promise<void>;
	disconnectPeer: (peerId: string) => void;
	disconnectAll: () => void;
}


const P2PContext = createContext<P2PContextType | null>(null);

export function P2PProvider({ children }: { children: React.ReactNode }) {
	const { workspace, refreshMetadata } = useWorkspace();
	const [peers, setPeers] = useState<ConnectedPeerInfo[]>([]);
	const [placeholders, setPlaceholders] = useState<PlaceholderItem[]>([]);

	const activeConnectionsRef = useRef<Map<string, P2PPeerConnection>>(new Map());
	const activeSyncProvidersRef = useRef<Set<P2PSyncProvider>>(new Set());
	const fileTransferRef = useRef<P2PFileTransfer>(new P2PFileTransfer());
	// One local PeerJS node in the host role (accepts many guests) and one in
	// the guest role (dials out to a single host) can be active at a time.
	const hostNodeRef = useRef<P2PLocalNode | null>(null);
	const guestNodeRef = useRef<P2PLocalNode | null>(null);
	const workspaceRef = useRef(workspace);
	workspaceRef.current = workspace;

	// Update list of active connected peers
	const refreshPeers = useCallback(() => {
		const peerList: ConnectedPeerInfo[] = [];
		activeConnectionsRef.current.forEach((peer) => {
			peerList.push(peer.getInfo());
		});
		setPeers(peerList);
	}, []);

	// Clean up connections ONLY when explicitly switching between different workspaces
	const prevWorkspaceIdRef = useRef<string | null>(null);
	useEffect(() => {
		const prevId = prevWorkspaceIdRef.current;
		const currentId = workspace?.id || null;

		if (prevId && currentId && prevId !== currentId) {
			// Actually switched from one active workspace to another
			hostNodeRef.current?.close();
			hostNodeRef.current = null;
			guestNodeRef.current?.close();
			guestNodeRef.current = null;
			activeConnectionsRef.current.clear();
			activeSyncProvidersRef.current.forEach((prov) => prov.destroy());
			activeSyncProvidersRef.current.clear();
			setPeers([]);
			setPlaceholders([]);
		}
		prevWorkspaceIdRef.current = currentId;
	}, [workspace?.id]);

	// Pack local workspace into a complete snapshot with 10MB lazy threshold
	const generateWorkspaceSnapshot = useCallback(async (): Promise<WorkspaceSyncSnapshot | null> => {
		const currentWs = workspaceRef.current;
		if (!currentWs?.path) return null;

		try {
			const metadata = await readWorkspaceMetadata(currentWs.path);
			const tasks = await getTasks(currentWs.path).catch(() => []);
			const kanban = await getKanban(currentWs.path).catch(() => []);

			// Collect all physical workspace files across standard content directories
			const subdirsToScan = ["notes", "files", "assets", "editor"];
			const collectedFiles: WorkspaceSyncFileItem[] = [];

			for (const sub of subdirsToScan) {
				const items = await listWorkspaceFiles(currentWs.path, sub).catch(() => []);
				for (const item of items) {
					if (item.is_dir) continue;
					if (item.path.includes(".nexsync")) continue;
					const cleanRelPath = item.path.startsWith("/") ? item.path.slice(1) : item.path;
					if (collectedFiles.some((f) => f.relPath === cleanRelPath)) continue;

					// Check 10MB lazy loading threshold
					if (item.size > LAZY_LOAD_THRESHOLD_BYTES) {
						collectedFiles.push({
							relPath: cleanRelPath,
							content: "",
							isBinary: true,
							size: item.size,
							isPlaceholder: true, // Above 10MB: send as on-demand placeholder
						});
						continue;
					}

					// Below 10MB: automatically include in initial sync
					const isMedia = /\.(png|jpg|jpeg|gif|webp|svg|mp4|webm|mp3|wav|pdf|ico)$/i.test(
						item.name,
					);
					try {
						if (isMedia) {
							const base64 = await readWorkspaceBinaryFile(currentWs.path, cleanRelPath);
							collectedFiles.push({
								relPath: cleanRelPath,
								content: base64,
								isBinary: true,
								size: item.size,
								isPlaceholder: false,
							});
						} else {
							const text = await readWorkspaceFile(currentWs.path, cleanRelPath);
							collectedFiles.push({
								relPath: cleanRelPath,
								content: text,
								isBinary: false,
								size: item.size,
								isPlaceholder: false,
							});
						}
					} catch (err) {
						console.warn(`Could not read file ${cleanRelPath} for snapshot:`, err);
					}
				}
			}

			return {
				workspaceId: currentWs.id,
				workspaceName: currentWs.name,
				metadata,
				tasks,
				kanban,
				files: collectedFiles,
			};
		} catch (err) {
			console.error("[P2P] Failed to generate workspace snapshot:", err);
			return null;
		}
	}, []);

	// Apply incoming workspace snapshot to local disk and SQLite
	const applyWorkspaceSnapshot = useCallback(
		async (snapshot: WorkspaceSyncSnapshot) => {
			const currentWs = workspaceRef.current;
			if (!currentWs?.path) {
				console.warn("[P2P] No active workspace path available to apply snapshot to.");
				return;
			}

			try {
				console.log("[P2P] Applying remote workspace snapshot...", snapshot);

				// 1. Write metadata & activity history
				if (snapshot.metadata) {
					const localMetadata = {
						...snapshot.metadata,
						workspace: {
							...snapshot.metadata.workspace,
							id: currentWs.id,
							path: currentWs.path,
						},
					};
					await writeWorkspaceMetadata({
						path: currentWs.path,
						metadata: localMetadata,
					}).catch(console.error);
				}

				// 2. Insert tasks
				if (snapshot.tasks && snapshot.tasks.length > 0) {
					for (const task of snapshot.tasks) {
						await createTask({ path: currentWs.path, task }).catch(() => {});
					}
				}

				// 3. Insert kanban columns and cards
				if (snapshot.kanban && snapshot.kanban.length > 0) {
					for (const col of snapshot.kanban) {
						await createKanbanColumn({ path: currentWs.path, column: col }).catch(() => {});
						if (col.cards) {
							for (const card of col.cards) {
								await createKanbanCard({ path: currentWs.path, card }).catch(() => {});
							}
						}
					}
				}

				// 4. Write files & register placeholders (>10MB)
				const newPlaceholders: PlaceholderItem[] = [];
				if (snapshot.files && snapshot.files.length > 0) {
					for (const file of snapshot.files) {
						const cleanRelPath = file.relPath.startsWith("/") ? file.relPath.slice(1) : file.relPath;
						if (file.isPlaceholder) {
							// File > 10MB: register as placeholder for on-demand downloading
							newPlaceholders.push({
								relPath: cleanRelPath,
								name: cleanRelPath.split("/").pop() || cleanRelPath,
								size: file.size || 0,
							});
						} else {
							// File <= 10MB: automatically save to local disk
							try {
								if (file.isBinary) {
									await writeWorkspaceBinaryFile(
										currentWs.path,
										cleanRelPath,
										file.content,
									);
								} else {
									await writeWorkspaceFile(
										currentWs.path,
										cleanRelPath,
										file.content,
									);
								}
							} catch (err) {
								console.warn(`Failed to write synced file ${cleanRelPath}:`, err);
							}
						}
					}
				}

				setPlaceholders((prev) => {
					const merged = [...prev];
					for (const p of newPlaceholders) {
						if (!merged.some((m) => m.relPath === p.relPath)) {
							merged.push(p);
						}
					}
					return merged;
				});

				// 5. Refresh workspace state in UI
				await refreshMetadata();
				console.log("[P2P] Workspace snapshot applied successfully!");
			} catch (err) {
				console.error("[P2P] Error applying workspace snapshot:", err);
			}
		},
		[refreshMetadata],
	);

	// Dynamic refs to avoid stale closures in WebRTC callbacks
	const refreshMetadataRef = useRef(refreshMetadata);
	refreshMetadataRef.current = refreshMetadata;

	// Broadcast local activity events to connected peers
	useEffect(() => {
		const unsubscribe = subscribeToActivityEvents((event) => {
			const msg: P2PMessage = {
				kind: "ACTIVITY_EVENT",
				senderId: "local",
				senderName: "local",
				timestamp: Date.now(),
				payload: JSON.stringify(event),
			};
			activeConnectionsRef.current.forEach((peer) => {
				peer.sendMessage(msg);
			});
		});
		return unsubscribe;
	}, []);

	// Request a single file on-demand (> 10MB) from connected peers
	const downloadFileOnDemand = useCallback(
		async (relPath: string) => {
			const cleanRelPath = relPath.startsWith("/") ? relPath.slice(1) : relPath;
			console.log(`[P2P] Requesting on-demand file download for: ${cleanRelPath}`);

			const msg: P2PMessage = {
				kind: "FILE_REQUEST",
				senderId: "local",
				senderName: "local",
				timestamp: Date.now(),
				payload: JSON.stringify({ relPath: cleanRelPath }),
			};

			activeConnectionsRef.current.forEach((peer) => {
				peer.sendMessage(msg);
			});
		},
		[],
	);

	// Handle workspace level protocol messages
	const handleWorkspaceMessage = useCallback(
		async (message: P2PMessage, peer: P2PPeerConnection) => {
			const currentWs = workspaceRef.current;

			switch (message.kind) {
				case "WORKSPACE_SYNC_REQUEST": {
					console.log("[P2P] Received sync request from peer. Generating snapshot...");
					const snapshot = await generateWorkspaceSnapshot();
					if (snapshot) {
						await peer.sendMessage({
							kind: "WORKSPACE_SYNC_RESPONSE",
							senderId: peer.peerId,
							senderName: peer.peerName,
							timestamp: Date.now(),
							payload: JSON.stringify(snapshot),
						});
					}
					break;
				}

				case "WORKSPACE_SYNC_RESPONSE": {
					if (message.payload) {
						try {
							const snapshot: WorkspaceSyncSnapshot = JSON.parse(message.payload);
							await applyWorkspaceSnapshot(snapshot);
						} catch (err) {
							console.error("[P2P] Failed to parse workspace snapshot:", err);
						}
					}
					break;
				}

				case "ACTIVITY_EVENT": {
					if (message.payload && currentWs?.path) {
						try {
							const event = JSON.parse(message.payload);
							const meta = await readWorkspaceMetadata(currentWs.path);
							if (!meta.activity.events.some((e) => e.id === event.id)) {
								const updatedMeta = {
									...meta,
									activity: {
										events: [event, ...meta.activity.events],
									},
								};
								await writeWorkspaceMetadata({
									path: currentWs.path,
									metadata: updatedMeta,
								});
								await refreshMetadataRef.current(currentWs.path);
								console.log("[P2P] Synced incoming activity event:", event.action);
							}
						} catch (err) {
							console.error("[P2P] Failed to apply activity event:", err);
						}
					}
					break;
				}

				case "FILE_REQUEST": {
					// Peer requested on-demand download for a specific file (>10MB)
					if (message.payload && currentWs?.path) {
						try {
							const { relPath } = JSON.parse(message.payload);
							const cleanRelPath = relPath.startsWith("/") ? relPath.slice(1) : relPath;
							console.log(`[P2P] Processing on-demand file request for: ${cleanRelPath}`);

							const base64Data = await readWorkspaceBinaryFile(currentWs.path, cleanRelPath);
							const rawBytes = base64UrlToBytes(base64Data);

							await fileTransferRef.current.sendFile(peer, {
								fileName: cleanRelPath.split("/").pop() || "file",
								relPath: cleanRelPath,
								data: rawBytes,
							});
						} catch (err) {
							console.error("[P2P] Failed to fulfill on-demand file request:", err);
						}
					}
					break;
				}

				default:
					break;
			}
		},
		[generateWorkspaceSnapshot, applyWorkspaceSnapshot],
	);

	const handleWorkspaceMessageRef = useRef(handleWorkspaceMessage);
	handleWorkspaceMessageRef.current = handleWorkspaceMessage;

	// Handler when on-demand file chunks finish streaming and are reassembled.
	// Registered once for the lifetime of the provider — previously this was
	// (re-)subscribed inside attachPeerToSystem, so every additional connected
	// peer added another duplicate listener that re-ran the same disk write.
	useEffect(() => {
		const unsubReceived = fileTransferRef.current.onFileReceived(async (header, data) => {
			const currentWs = workspaceRef.current;
			if (!currentWs?.path) return;

			try {
				const base64 = bytesToBase64Url(data);
				await writeWorkspaceBinaryFile(currentWs.path, header.relPath, base64);
				setPlaceholders((prev) => prev.filter((p) => p.relPath !== header.relPath));
				await refreshMetadataRef.current(currentWs.path);
				console.log(`[P2P] On-demand file ${header.relPath} downloaded and saved!`);
			} catch (err) {
				console.error("[P2P] Failed to save downloaded on-demand file:", err);
			}
		});

		const unsubError = fileTransferRef.current.onError((fileId, message) => {
			console.warn(`[P2P] File transfer ${fileId} failed: ${message}`);
		});

		return () => {
			unsubReceived();
			unsubError();
		};
	}, []);

	// Attach peer to existing sync providers and file transfer handlers, and
	// register it in the shared connection map keyed by its (immediately
	// known, pre-handshake) remote PeerJS id — unique per connection, which is
	// what makes multi-guest hosting work correctly.
	const attachPeerToSystem = useCallback(
		(peer: P2PPeerConnection) => {
			const connectionKey = peer.remotePeerId ?? peer.peerId;
			activeConnectionsRef.current.set(connectionKey, peer);

			// Register with file transfer
			fileTransferRef.current.attachPeer(peer);

			// Register with existing Yjs providers
			activeSyncProvidersRef.current.forEach((provider) => {
				provider.addPeer(peer);
			});

			// Listen for workspace sync messages via dynamic handler ref to avoid stale closures
			peer.onMessage((msg) => {
				handleWorkspaceMessageRef.current(msg, peer);
			});

			// Listen for peer status changes
			peer.onStatusChange((status) => {
				refreshPeers();
				if (status === "connected") {
					// Auto-request sync snapshot upon connection
					peer.sendMessage({
						kind: "WORKSPACE_SYNC_REQUEST",
						senderId: peer.peerId,
						senderName: peer.peerName,
						timestamp: Date.now(),
					});
				} else if (status === "failed" || status === "disconnected" || status === "closed") {
					if (activeConnectionsRef.current.get(connectionKey) === peer) {
						activeConnectionsRef.current.delete(connectionKey);
						activeSyncProvidersRef.current.forEach((prov) => prov.removePeer(peer));
						refreshPeers();
					}
				}
			});

			refreshPeers();
		},
		[refreshPeers],
	);

	// Resolves once a peer's handshake finishes (or rejects on failure/timeout).
	function waitForHandshakeOutcome(peer: P2PPeerConnection, timeoutMs = 20_000): Promise<void> {
		return new Promise((resolve, reject) => {
			let settled = false;
			let unsub: () => void = () => {};

			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				unsub();
				reject(new Error("Connection timed out. Check the code and that the host is online."));
			}, timeoutMs);

			unsub = peer.onStatusChange((status) => {
				if (settled) return;
				if (status === "connected") {
					settled = true;
					clearTimeout(timer);
					unsub();
					resolve();
				} else if (status === "failed" || status === "closed" || status === "disconnected") {
					settled = true;
					clearTimeout(timer);
					unsub();
					reject(
						new Error(
							"Couldn't connect — the code may be wrong, expired, or the host went offline.",
						),
					);
				}
			});
		});
	}

	// Resolves once the peer sends its WORKSPACE_INFO greeting (workspace id/name).
	function waitForWorkspaceInfo(
		peer: P2PPeerConnection,
		timeoutMs = 10_000,
	): Promise<{ workspaceId: string; workspaceName: string }> {
		return new Promise((resolve, reject) => {
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				unsub();
				reject(new Error("Host did not send workspace information in time."));
			}, timeoutMs);

			const unsub = peer.onMessage((msg) => {
				if (settled || msg.kind !== "WORKSPACE_INFO" || !msg.payload) return;
				try {
					const info = JSON.parse(msg.payload);
					settled = true;
					clearTimeout(timer);
					unsub();
					resolve({ workspaceId: info.workspaceId, workspaceName: info.workspaceName });
				} catch {
					// Malformed WORKSPACE_INFO — keep waiting for a well-formed one
					// (or the timeout) rather than failing on one bad frame.
				}
			});
		});
	}

	// Generates a high-entropy short code (e.g. NX-7F3K-9QRT) and starts
	// accepting guest connections under it. Unlike the old implementation,
	// the host's `P2PLocalNode` stays open and can accept any number of
	// simultaneous guests — each gets its own authenticated, forward-secret
	// session key, so one guest can never see another's handshake material.
	const createShortCodeInvite = useCallback(
		async (role: string = "Editor") => {
			const ws = workspaceRef.current;
			if (!ws) {
				throw new Error("No active workspace to invite collaborators into.");
			}

			hostNodeRef.current?.close();

			const shortCode = generateShortCode();
			const [rendezvousId, authKey] = await Promise.all([
				deriveHostRendezvousId(shortCode),
				deriveCodeAuthKey(shortCode),
			]);

			const hostId = `host-${Date.now().toString(36)}`;
			const node = new P2PLocalNode({ peerId: hostId, peerName: "Host", role });
			hostNodeRef.current = node;

			node.onPeerJoined((peer) => {
				attachPeerToSystem(peer);
				// Greet the new guest with the workspace identity immediately;
				// they don't need to wait for a full snapshot round trip to know
				// which workspace they've joined.
				void peer.sendMessage({
					kind: "WORKSPACE_INFO",
					senderId: peer.peerId,
					senderName: peer.peerName,
					timestamp: Date.now(),
					payload: JSON.stringify({ workspaceId: ws.id, workspaceName: ws.name }),
				});
			});

			node.onError((err) => {
				console.error("[P2P] Host node error:", err);
			});

			await node.listen(rendezvousId, authKey);

			return { shortCode };
		},
		[attachPeerToSystem],
	);

	// Joins a remote workspace using a short code shared by the host. The code
	// is never sent anywhere and never used as the encryption key — it only
	// derives the rendezvous ID and authenticates a fresh ECDH handshake.
	const joinWithShortCode = useCallback(
		async (shortCode: string) => {
			const trimmed = shortCode.trim();
			const [rendezvousId, authKey] = await Promise.all([
				deriveHostRendezvousId(trimmed),
				deriveCodeAuthKey(trimmed),
			]);

			guestNodeRef.current?.close();
			const guestId = `peer-${Date.now().toString(36)}`;
			const node = new P2PLocalNode({ peerId: guestId, peerName: "Guest Collaborator", role: "Editor" });
			guestNodeRef.current = node;

			const peer = await node.connectTo(rendezvousId, authKey);
			attachPeerToSystem(peer);

			await waitForHandshakeOutcome(peer);
			const { workspaceId, workspaceName } = await waitForWorkspaceInfo(peer);

			return { workspaceId, workspaceName, peer };
		},
		[attachPeerToSystem],
	);

	// Explicitly request full workspace snapshot from peer(s)
	const requestWorkspaceSnapshot = useCallback(
		async (targetPeer?: P2PPeerConnection) => {
			const msg: P2PMessage = {
				kind: "WORKSPACE_SYNC_REQUEST",
				senderId: "local",
				senderName: "local",
				timestamp: Date.now(),
			};

			if (targetPeer) {
				await targetPeer.sendMessage(msg);
			} else {
				activeConnectionsRef.current.forEach((peer) => {
					peer.sendMessage(msg);
				});
			}
		},
		[],
	);

	// Create and register a Yjs synchronization provider
	const createSyncProvider = useCallback(
		(doc: Y.Doc, docId: string = "root") => {
			const provider = new P2PSyncProvider(doc, { docId });

			// Attach all existing peers
			activeConnectionsRef.current.forEach((peer) => {
				provider.addPeer(peer);
			});

			activeSyncProvidersRef.current.add(provider);
			return provider;
		},
		[],
	);

	const disconnectPeer = useCallback(
		(peerId: string) => {
			const peer = activeConnectionsRef.current.get(peerId);
			if (peer) {
				peer.close();
				activeConnectionsRef.current.delete(peerId);
				activeSyncProvidersRef.current.forEach((prov) => prov.removePeer(peer));
				refreshPeers();
			}
		},
		[refreshPeers],
	);

	const disconnectAll = useCallback(() => {
		hostNodeRef.current?.close();
		hostNodeRef.current = null;
		guestNodeRef.current?.close();
		guestNodeRef.current = null;
		activeConnectionsRef.current.forEach((peer) => peer.close());
		activeConnectionsRef.current.clear();
		activeSyncProvidersRef.current.forEach((prov) => prov.destroy());
		activeSyncProvidersRef.current.clear();
		refreshPeers();
	}, [refreshPeers]);

	// Derive high-level connection status
	const connectedCount = peers.filter((p) => p.status === "connected").length;
	const connectingCount = peers.filter((p) => p.status === "connecting" || p.status === "new").length;

	let connectionStatus: "offline" | "connecting" | "connected" = "offline";
	if (connectedCount > 0) {
		connectionStatus = "connected";
	} else if (connectingCount > 0) {
		connectionStatus = "connecting";
	}

	return (
		<P2PContext.Provider
			value={{
				peers,
				connectionStatus,
				placeholders,
				createShortCodeInvite,
				joinWithShortCode,
				createSyncProvider,
				fileTransfer: fileTransferRef.current,
				requestWorkspaceSnapshot,
				downloadFileOnDemand,
				disconnectPeer,
				disconnectAll,
			}}
		>
			{children}
		</P2PContext.Provider>
	);
}

export function useP2P() {
	const context = useContext(P2PContext);
	if (!context) {
		throw new Error("useP2P must be used within a P2PProvider");
	}
	return context;
}
