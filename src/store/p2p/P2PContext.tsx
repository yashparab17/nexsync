// Global P2P collaboration state backed by the Rust Iroh node: peers, invites, workspace snapshot sync and on-demand file downloads

import React, {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import * as Y from "yjs";
import {
	p2p,
	P2PSyncProvider,
	type ConnectedPeerInfo,
	type InviteInfo,
	type JoinResult,
	type P2PMessage,
	type WorkspaceSyncSnapshot,
} from "@/lib/p2p";
import {
	useWorkspace,
	subscribeToActivityEvents,
} from "@/store/workspace/WorkspaceContext";
import {
	readWorkspaceMetadata,
	writeWorkspaceMetadata,
	getTasks,
	createTask,
	getKanban,
	createKanbanColumn,
	createKanbanCard,
} from "@/lib/tauri";

// Files above this size are listed as placeholders during sync and downloaded on demand
export const LAZY_LOAD_THRESHOLD_BYTES = 10 * 1024 * 1024;

export interface PlaceholderItem {
	relPath: string;
	name: string;
	size: number;
	peerId: string; // Peer that has the file
}

export interface SyncProgress {
	filesDone: number;
	filesTotal: number;
	currentFile: string | null;
	currentFileBytes?: number;
	currentFileTotal?: number;
}

// One-line summary of an in-progress workspace sync
export function describeSyncProgress(progress: SyncProgress): string {
	const { filesDone, filesTotal, currentFile, currentFileBytes, currentFileTotal } = progress;
	if (!currentFile) return "Syncing workspace…";
	const percent =
		currentFileTotal && currentFileBytes !== undefined
			? ` (${Math.round((currentFileBytes / currentFileTotal) * 100)}%)`
			: "";
	return `Downloading file ${filesDone + 1} of ${filesTotal}: ${currentFile}${percent}`;
}

// Last file a collaborator changed; `version` changes on every update so pages can reload
export interface SyncedFile {
	relPath: string; // Empty after a full workspace sync
	version: number;
}

interface P2PContextType {
	peers: ConnectedPeerInfo[];
	connectionStatus: "offline" | "connecting" | "connected";
	placeholders: PlaceholderItem[];
	syncProgress: SyncProgress | null;
	lastSyncedFile: SyncedFile | null;
	createInvite: (role?: string) => Promise<InviteInfo>;
	revokeInvite: () => Promise<void>;
	joinWithTicket: (ticket: string, displayName?: string) => Promise<JoinResult>;
	createSyncProvider: (doc: Y.Doc, docId?: string) => P2PSyncProvider;
	requestWorkspaceSnapshot: (peerId?: string, targetWorkspacePath?: string) => Promise<void>;
	downloadFileOnDemand: (relPath: string) => Promise<void>;
	disconnectPeer: (peerId: string) => Promise<void>;
	disconnectAll: () => Promise<void>;
}

const P2PContext = createContext<P2PContextType | null>(null);

const stripLeadingSlash = (path: string) => (path.startsWith("/") ? path.slice(1) : path);

// Provides P2P state and actions to the whole app
export function P2PProvider({ children }: { children: React.ReactNode }) {
	const { workspace, metadata, refreshMetadata } = useWorkspace();
	const [peers, setPeers] = useState<ConnectedPeerInfo[]>([]);
	const [placeholders, setPlaceholders] = useState<PlaceholderItem[]>([]);
	const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
	const [lastSyncedFile, setLastSyncedFile] = useState<SyncedFile | null>(null);
	const [isJoining, setIsJoining] = useState(false);
	const syncVersionRef = useRef(0);

	const markSynced = useCallback((relPath: string) => {
		syncVersionRef.current += 1;
		setLastSyncedFile({ relPath, version: syncVersionRef.current });
	}, []);

	const workspaceRef = useRef(workspace);
	workspaceRef.current = workspace;
	const metadataRef = useRef(metadata);
	metadataRef.current = metadata;
	const refreshMetadataRef = useRef(refreshMetadata);
	refreshMetadataRef.current = refreshMetadata;
	const placeholdersRef = useRef(placeholders);
	placeholdersRef.current = placeholders;

	const peersRef = useRef<ConnectedPeerInfo[]>([]);
	const syncProvidersRef = useRef<Set<P2PSyncProvider>>(new Set());
	// Peers we asked for a snapshot, mapped to the local workspace path to apply it to
	const pendingSnapshotsRef = useRef<Map<string, string | null>>(new Map());

	const send = useCallback((message: P2PMessage, peerId?: string) => {
		p2p.sendMessage(message, peerId).catch((err) =>
			console.warn("[P2P] Failed to send message:", err),
		);
	}, []);

	// Share the open workspace's files with connected peers (none when no workspace is open)
	useEffect(() => {
		p2p.setSharedWorkspace(workspace?.path ?? null).catch((err) =>
			console.error("[P2P] Failed to set shared workspace:", err),
		);
	}, [workspace?.path]);

	// Leaving a workspace drops its collaborators so they can't reach the next one opened
	const prevWorkspaceIdRef = useRef<string | null>(null);
	useEffect(() => {
		const prevId = prevWorkspaceIdRef.current;
		const currentId = workspace?.id ?? null;
		if (prevId && prevId !== currentId) {
			p2p.disconnectAll().catch(console.error);
			syncProvidersRef.current.forEach((provider) => provider.destroy());
			syncProvidersRef.current.clear();
			pendingSnapshotsRef.current.clear();
			setPlaceholders([]);
			setSyncProgress(null);
		}
		prevWorkspaceIdRef.current = currentId;
	}, [workspace?.id]);

	// Track connected peers and attach them to live Yjs providers
	useEffect(() => {
		const updatePeers = (list: ConnectedPeerInfo[]) => {
			peersRef.current = list;
			setPeers(list);
		};
		p2p.listPeers().then(updatePeers).catch(() => {});

		const offPeers = p2p.onPeers(updatePeers);
		const offJoined = p2p.onPeerJoined((peer) => {
			syncProvidersRef.current.forEach((provider) => provider.addPeer(peer.id));
		});
		const offLeft = p2p.onPeerLeft(({ peerId }) => {
			syncProvidersRef.current.forEach((provider) => provider.removePeer(peerId));
			pendingSnapshotsRef.current.delete(peerId);
		});
		return () => {
			offPeers();
			offJoined();
			offLeft();
		};
	}, []);

	// Broadcast local activity events to connected peers
	useEffect(() => {
		return subscribeToActivityEvents((event) => {
			if (peersRef.current.length === 0) return;
			send({
				kind: "ACTIVITY_EVENT",
				timestamp: Date.now(),
				payload: JSON.stringify(event),
			});
		});
	}, [send]);

	// Build a snapshot of the open workspace; file contents are streamed separately on request
	const generateWorkspaceSnapshot = useCallback(async (): Promise<WorkspaceSyncSnapshot | null> => {
		const ws = workspaceRef.current;
		if (!ws?.path) return null;

		try {
			const [metadata, tasks, kanban, files] = await Promise.all([
				readWorkspaceMetadata(ws.path),
				getTasks(ws.path).catch(() => []),
				getKanban(ws.path).catch(() => []),
				p2p.listShareableFiles(ws.path),
			]);
			return {
				workspaceId: ws.id,
				workspaceName: ws.name,
				metadata,
				tasks,
				kanban,
				files: files.map((file) => ({
					relPath: file.relPath,
					size: file.size,
					isPlaceholder: file.size > LAZY_LOAD_THRESHOLD_BYTES,
				})),
			};
		} catch (err) {
			console.error("[P2P] Failed to build workspace snapshot:", err);
			return null;
		}
	}, []);

	// Write a peer's snapshot into a local workspace and download its smaller files
	const applyWorkspaceSnapshot = useCallback(
		async (snapshot: WorkspaceSyncSnapshot, fromPeerId: string, targetPath: string | null) => {
			const path = targetPath ?? workspaceRef.current?.path;
			if (!path) {
				console.warn("[P2P] No local workspace to apply the snapshot to.");
				return;
			}

			try {
				// Keep this device's workspace identity; take everything else from the peer
				const local = await readWorkspaceMetadata(path);
				await writeWorkspaceMetadata({
					path,
					metadata: {
						...snapshot.metadata,
						workspace: {
							...snapshot.metadata.workspace,
							id: local.workspace.id,
							path: local.workspace.path,
						},
					},
				});

				// Existing rows fail to insert, so re-syncing only adds what's missing
				for (const task of snapshot.tasks ?? []) {
					await createTask({ path, task }).catch(() => {});
				}
				for (const column of snapshot.kanban ?? []) {
					await createKanbanColumn({ path, column }).catch(() => {});
					for (const card of column.cards ?? []) {
						await createKanbanCard({ path, card }).catch(() => {});
					}
				}

				const eager = snapshot.files.filter((f) => !f.isPlaceholder);
				const lazy: PlaceholderItem[] = snapshot.files
					.filter((f) => f.isPlaceholder)
					.map((f) => ({
						relPath: stripLeadingSlash(f.relPath),
						name: f.relPath.split("/").pop() || f.relPath,
						size: f.size,
						peerId: fromPeerId,
					}));

				let failed = 0;
				for (let i = 0; i < eager.length; i++) {
					const relPath = stripLeadingSlash(eager[i].relPath);
					setSyncProgress({ filesDone: i, filesTotal: eager.length, currentFile: relPath });
					try {
						await p2p.fetchFile(fromPeerId, path, relPath);
					} catch (err) {
						failed++;
						console.warn(`[P2P] Failed to download ${relPath}:`, err);
					}
				}

				setPlaceholders((prev) => [
					...prev.filter((p) => !lazy.some((l) => l.relPath === p.relPath)),
					...lazy,
				]);
				await refreshMetadataRef.current(path);
				markSynced("");
				if (failed > 0) {
					console.warn(`[P2P] Workspace synced with ${failed} file(s) missing.`);
				}
			} catch (err) {
				console.error("[P2P] Failed to apply workspace snapshot:", err);
			} finally {
				setSyncProgress(null);
			}
		},
		[markSynced],
	);

	// Handle an incoming app message from a peer
	const handleMessage = useCallback(
		async (peerId: string, message: P2PMessage) => {
			switch (message.kind) {
				case "SYNC_STEP_1":
				case "SYNC_STEP_2":
				case "SYNC_UPDATE":
					syncProvidersRef.current.forEach((provider) =>
						provider.handleMessage(peerId, message),
					);
					break;

				case "WORKSPACE_SYNC_REQUEST": {
					const snapshot = await generateWorkspaceSnapshot();
					if (snapshot) {
						send(
							{
								kind: "WORKSPACE_SYNC_RESPONSE",
								timestamp: Date.now(),
								payload: JSON.stringify(snapshot),
							},
							peerId,
						);
					}
					break;
				}

				case "WORKSPACE_SYNC_RESPONSE": {
					// Only apply snapshots we asked for, so a peer can't overwrite our workspace uninvited
					if (!pendingSnapshotsRef.current.has(peerId) || !message.payload) {
						console.warn("[P2P] Ignoring unsolicited workspace snapshot from", peerId);
						break;
					}
					const targetPath = pendingSnapshotsRef.current.get(peerId) ?? null;
					pendingSnapshotsRef.current.delete(peerId);
					try {
						const snapshot: WorkspaceSyncSnapshot = JSON.parse(message.payload);
						await applyWorkspaceSnapshot(snapshot, peerId, targetPath);
					} catch (err) {
						console.error("[P2P] Received a malformed workspace snapshot:", err);
					}
					break;
				}

				case "ACTIVITY_EVENT": {
					const path = workspaceRef.current?.path;
					if (!path || !message.payload) break;
					try {
						const event = JSON.parse(message.payload);
						const meta = await readWorkspaceMetadata(path);
						if (meta.activity.events.some((e) => e.id === event.id)) break;
						await writeWorkspaceMetadata({
							path,
							metadata: {
								...meta,
								activity: { events: [event, ...meta.activity.events] },
							},
						});
						await refreshMetadataRef.current(path);
					} catch (err) {
						console.error("[P2P] Failed to apply activity event:", err);
					}
					break;
				}
			}
		},
		[generateWorkspaceSnapshot, applyWorkspaceSnapshot, send],
	);

	const handleMessageRef = useRef(handleMessage);
	handleMessageRef.current = handleMessage;

	useEffect(() => {
		return p2p.onMessage(({ peerId, message }) => {
			void handleMessageRef.current(peerId, message);
		});
	}, []);

	// Live file sync: surface collaborators' changes and large files that need a manual download
	useEffect(() => {
		let statsTimer: ReturnType<typeof setTimeout> | undefined;
		const offChanged = p2p.onFilesChanged(({ relPath }) => {
			setPlaceholders((prev) => prev.filter((p) => p.relPath !== relPath));
			markSynced(relPath);
			// Refresh dashboard counts once a burst of changes settles
			clearTimeout(statsTimer);
			statsTimer = setTimeout(() => void refreshMetadataRef.current(), 1000);
		});
		const offRemote = p2p.onRemoteFile(({ peerId, relPath, size }) => {
			setPlaceholders((prev) => [
				...prev.filter((p) => p.relPath !== relPath),
				{ relPath, name: relPath.split("/").pop() || relPath, size, peerId },
			]);
		});
		return () => {
			clearTimeout(statsTimer);
			offChanged();
			offRemote();
		};
	}, [markSynced]);

	// Attach byte progress to the file currently being synced
	useEffect(() => {
		return p2p.onFileProgress((event) => {
			setSyncProgress((prev) =>
				prev && prev.currentFile === event.relPath
					? { ...prev, currentFileBytes: event.receivedBytes, currentFileTotal: event.totalBytes }
					: prev,
			);
		});
	}, []);

	// Create an invite ticket; generating a new one invalidates the previous ticket
	const createInvite = useCallback(async (role: string = "Editor") => {
		const ws = workspaceRef.current;
		if (!ws) {
			throw new Error("Open a workspace before inviting collaborators.");
		}
		const owner = metadataRef.current?.members.members.find(
			(m) => m.role.toLowerCase() === "owner",
		);
		return p2p.createInvite({
			role,
			workspaceId: ws.id,
			workspaceName: ws.name,
			hostName: owner?.name || "Host",
		});
	}, []);

	const revokeInvite = useCallback(() => p2p.revokeInvite(), []);

	// Connect to a host from an invite ticket
	const joinWithTicket = useCallback(async (ticket: string, displayName = "Collaborator") => {
		setIsJoining(true);
		try {
			return await p2p.joinWithTicket(ticket.trim(), displayName);
		} finally {
			setIsJoining(false);
		}
	}, []);

	// Ask a peer (default: the host we joined) for its workspace and apply it locally
	const requestWorkspaceSnapshot = useCallback(
		async (peerId?: string, targetWorkspacePath?: string) => {
			const targets = peerId
				? [peerId]
				: peersRef.current.filter((p) => p.isHost).map((p) => p.id);
			for (const target of targets) {
				pendingSnapshotsRef.current.set(target, targetWorkspacePath ?? null);
				await p2p.sendMessage({ kind: "WORKSPACE_SYNC_REQUEST", timestamp: Date.now() }, target);
			}
		},
		[],
	);

	// Download a large file that was skipped during the initial sync
	const downloadFileOnDemand = useCallback(async (relPath: string) => {
		const path = workspaceRef.current?.path;
		if (!path) throw new Error("No workspace is open.");

		const cleanPath = stripLeadingSlash(relPath);
		const placeholder = placeholdersRef.current.find((p) => p.relPath === cleanPath);
		const connected = peersRef.current;
		const source =
			connected.find((p) => p.id === placeholder?.peerId) ??
			connected.find((p) => p.isHost) ??
			connected[0];
		if (!source) {
			throw new Error("Connect to a collaborator who has this file to download it.");
		}

		await p2p.fetchFile(source.id, path, cleanPath);
		setPlaceholders((prev) => prev.filter((p) => p.relPath !== cleanPath));
		await refreshMetadataRef.current(path);
	}, []);

	// Create a Yjs provider that stays in sync with every connected peer
	const createSyncProvider = useCallback(
		(doc: Y.Doc, docId: string = "root") => {
			const provider = new P2PSyncProvider(doc, (message, peerId) => send(message, peerId), docId);
			peersRef.current.forEach((peer) => provider.addPeer(peer.id));
			syncProvidersRef.current.add(provider);
			return provider;
		},
		[send],
	);

	const disconnectPeer = useCallback((peerId: string) => p2p.disconnectPeer(peerId), []);
	const disconnectAll = useCallback(() => p2p.disconnectAll(), []);

	const connectionStatus: P2PContextType["connectionStatus"] =
		peers.length > 0 ? "connected" : isJoining ? "connecting" : "offline";

	return (
		<P2PContext.Provider
			value={{
				peers,
				connectionStatus,
				placeholders,
				syncProgress,
				lastSyncedFile,
				createInvite,
				revokeInvite,
				joinWithTicket,
				createSyncProvider,
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
