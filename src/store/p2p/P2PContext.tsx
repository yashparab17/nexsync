// Global P2P WebRTC Context providing decentralized mesh management, E2EE synchronization, and lazy on-demand asset transfers

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";
import { generateE2eeKey, base64UrlToBytes, bytesToBase64Url } from "@/lib/crypto/e2ee";
import {
	P2PPeerConnection,
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
	activeE2eeKey: CryptoKey | null;
	placeholders: PlaceholderItem[];
	createShortCodeInvite: (role?: string) => Promise<{ shortCode: string; tempPeer: P2PPeerConnection }>;
	joinWithShortCode: (shortCode: string) => Promise<{
		workspaceId: string;
		workspaceName: string;
		peer: P2PPeerConnection;
	}>;
	createInvite: (role?: string) => Promise<{ inviteCode: string; tempPeer: P2PPeerConnection }>;
	acceptAnswer: (peer: P2PPeerConnection, answerCode: string) => Promise<void>;
	joinWorkspaceFromInvite: (inviteCode: string) => Promise<{
		workspaceId: string;
		workspaceName: string;
		answerCode: string;
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
	const [activeE2eeKey, setActiveE2eeKey] = useState<CryptoKey | null>(null);
	const [placeholders, setPlaceholders] = useState<PlaceholderItem[]>([]);

	const activeConnectionsRef = useRef<Map<string, P2PPeerConnection>>(new Map());
	const activeSyncProvidersRef = useRef<Set<P2PSyncProvider>>(new Set());
	const fileTransferRef = useRef<P2PFileTransfer>(new P2PFileTransfer());
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
			activeConnectionsRef.current.forEach((peer) => peer.close());
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

	// Attach peer to existing sync providers and file transfer handlers
	const attachPeerToSystem = useCallback(
		(peer: P2PPeerConnection) => {
			// Register with file transfer
			fileTransferRef.current.attachPeer(peer);

			// Handler when file chunks finish streaming
			fileTransferRef.current.onFileReceived(async (header, data) => {
				const currentWs = workspaceRef.current;
				if (!currentWs?.path) return;

				try {
					const base64 = bytesToBase64Url(data);
					await writeWorkspaceBinaryFile(currentWs.path, header.relPath, base64);
					// Remove from placeholders
					setPlaceholders((prev) => prev.filter((p) => p.relPath !== header.relPath));
					await refreshMetadataRef.current(currentWs.path);
					console.log(`[P2P] On-demand file ${header.relPath} downloaded and saved!`);
				} catch (err) {
					console.error("[P2P] Failed to save downloaded on-demand file:", err);
				}
			});

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
				// Auto-request sync snapshot upon connection
				if (status === "connected") {
					peer.sendMessage({
						kind: "WORKSPACE_SYNC_REQUEST",
						senderId: peer.peerId,
						senderName: peer.peerName,
						timestamp: Date.now(),
					});
				}
			});

			refreshPeers();
		},
		[refreshPeers],
	);

	// Generate Host Short Code (e.g. NX-8492) and start background signaling
	const createShortCodeInvite = useCallback(
		async (role: string = "Editor") => {
			if (!workspaceRef.current) {
				throw new Error("No active workspace to invite collaborators into.");
			}

			// Generate a clean 6-character short code like NX-7492
			const randomDigits = Math.floor(1000 + Math.random() * 9000);
			const shortCode = `NX-${randomDigits}`;

			const hostPeerId = `host-${Date.now().toString(36)}`;
			const tempPeer = new P2PPeerConnection({
				peerId: hostPeerId,
				peerName: "Host",
				role,
			});

			activeConnectionsRef.current.set(hostPeerId, tempPeer);
			attachPeerToSystem(tempPeer);

			await tempPeer.hostWithShortCode(
				shortCode,
				workspaceRef.current.id,
				workspaceRef.current.name,
			);

			return { shortCode, tempPeer };
		},
		[attachPeerToSystem],
	);

	// Join a remote workspace using only a 1-step Short Code (e.g. NX-8492)
	const joinWithShortCode = useCallback(
		async (shortCode: string) => {
			const guestPeerId = `peer-${Date.now().toString(36)}`;
			const peer = new P2PPeerConnection({
				peerId: guestPeerId,
				peerName: "Guest Collaborator",
				role: "Editor",
			});

			activeConnectionsRef.current.set(guestPeerId, peer);
			attachPeerToSystem(peer);

			const { workspaceId, workspaceName } = await peer.joinWithShortCode(shortCode.trim());

			return {
				workspaceId,
				workspaceName,
				peer,
			};
		},
		[attachPeerToSystem],
	);

	// Generate Host Invite Code with new/current E2EE Key
	const createInvite = useCallback(
		async (role: string = "Editor") => {
			if (!workspaceRef.current) {
				throw new Error("No active workspace to invite collaborators into.");
			}

			let key = activeE2eeKey;
			if (!key) {
				key = await generateE2eeKey();
				setActiveE2eeKey(key);
			}

			const hostPeerId = `host-${Date.now().toString(36)}`;
			const tempPeer = new P2PPeerConnection({
				peerId: hostPeerId,
				peerName: "Host",
				role,
			});

			activeConnectionsRef.current.set(hostPeerId, tempPeer);
			attachPeerToSystem(tempPeer);

			const inviteCode = await tempPeer.createHostInvite(
				workspaceRef.current.id,
				workspaceRef.current.name,
				key,
			);

			return { inviteCode, tempPeer };
		},
		[activeE2eeKey, attachPeerToSystem],
	);

	// Accept Joiner's answer to finalize WebRTC handshake
	const acceptAnswer = useCallback(
		async (peer: P2PPeerConnection, answerCode: string) => {
			await peer.acceptAnswer(answerCode);
			refreshPeers();
		},
		[refreshPeers],
	);

	// Join a remote workspace from an invite code
	const joinWorkspaceFromInvite = useCallback(
		async (inviteCode: string) => {
			const guestPeerId = `peer-${Date.now().toString(36)}`;
			const peer = new P2PPeerConnection({
				peerId: guestPeerId,
				peerName: "Guest Collaborator",
				role: "Editor",
			});

			const { workspaceId, workspaceName, answerCode } =
				await peer.joinFromInvite(inviteCode);

			activeConnectionsRef.current.set(guestPeerId, peer);
			attachPeerToSystem(peer);

			return {
				workspaceId,
				workspaceName,
				answerCode,
				peer,
			};
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
				activeE2eeKey,
				placeholders,
				createShortCodeInvite,
				joinWithShortCode,
				createInvite,
				acceptAnswer,
				joinWorkspaceFromInvite,
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
