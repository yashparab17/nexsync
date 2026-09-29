// Global P2P collaboration state backed by the Rust Iroh node: peers, invites, workspace snapshot sync and on-demand file downloads

import React, {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import {
	p2p,
	P2PSyncProvider,
	applyDataChange,
	upsertKanbanCard,
	upsertTask,
	type ConnectedPeerInfo,
	type DataChange,
	type InviteInfo,
	type JoinRequest,
	type JoinResult,
	type ShortCodeInfo,
	type P2PMessage,
	type WorkspaceSyncSnapshot,
} from "@/lib/p2p";
import {
	useWorkspace,
	subscribeToActivityEvents,
} from "@/store/workspace/WorkspaceContext";
import {
	base64ToUint8Array,
	readWorkspaceMetadata,
	writeWorkspaceMetadata,
	getTasks,
	getKanban,
	createKanbanColumn,
	loadConfig,
} from "@/lib/tauri";
import type { Member } from "@/types/workspace";
import { bindGuestMember, canChangeRole, roleTable } from "@/lib/roles";
import { applyCatchUp, buildInventory, updatesFor, type Inventory } from "@/lib/p2p/yjsCatchUp";

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

// Name this device joined a workspace under, keyed by the local copy's id (paths vary in spelling)
const selfNameKey = (workspaceId: string) => `nexsync.selfName:${workspaceId}`;

function readSelfName(workspaceId: string | undefined): string | null {
	if (!workspaceId) return null;
	try {
		return localStorage.getItem(selfNameKey(workspaceId));
	} catch {
		return null;
	}
}

function setSelfName(workspaceId: string, name: string | null) {
	try {
		if (name === null) localStorage.removeItem(selfNameKey(workspaceId));
		else localStorage.setItem(selfNameKey(workspaceId), name);
	} catch {
		// Only affects whether this copy shows the host's controls
	}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const HANDOFF_TIMEOUT_MS = 60_000;

// A file being downloaded from a peer
export interface FileTransfer {
	peerId: string;
	relPath: string;
	receivedBytes: number;
	totalBytes: number;
}

// What the host sends a guest it wants to hand hosting to: the member list with the roles already swapped
export interface HandoffOffer {
	from: string; // Peer id of the current host
	hostName: string;
	members: Member[];
}

function isMemberList(value: unknown): value is Member[] {
	return (
		Array.isArray(value) &&
		value.every(
			(m) =>
				m &&
				typeof m.id === "string" &&
				typeof m.name === "string" &&
				typeof m.role === "string",
		)
	);
}

interface P2PContextType {
	peers: ConnectedPeerInfo[];
	connectionStatus: "offline" | "connecting" | "reconnecting" | "connected";
	placeholders: PlaceholderItem[];
	syncProgress: SyncProgress | null;
	lastSyncedFile: SyncedFile | null;
	dataVersion: number; // Changes whenever a collaborator's task/kanban edit is applied
	selfName: string | null; // Our member name in a workspace we joined; null in our own workspaces
	selfId: string | null; // Our device key, set once we have joined a workspace
	requestRoleChange: (deviceId: string, role: string) => void; // Admin guests only; the host decides
	transfers: FileTransfer[]; // Downloads in progress, from live sync, catch-up or a workspace snapshot
	cancelTransfers: (relPath?: string) => Promise<void>; // One file, or every download when omitted
	handoffOffer: HandoffOffer | null; // The host asked this device to take over hosting
	acceptHandoff: () => Promise<void>;
	declineHandoff: () => void;
	transferHost: (peerId: string) => Promise<void>; // Owner only: hand ownership and hosting to a connected member
	publishDataChange: (change: DataChange) => void;
	createInvite: (role?: string) => Promise<InviteInfo>;
	createShortCode: (role?: string) => Promise<ShortCodeInfo>;
	joinRequests: JoinRequest[]; // Guests waiting for this host to allow or deny them
	resolveJoinRequest: (requestId: string, approve: boolean) => Promise<void>;
	workspaceDeleted: boolean; // The host told us they deleted this workspace
	dismissWorkspaceDeleted: () => void;
	announceWorkspaceDeleted: () => Promise<void>;
	revokeInvite: () => Promise<void>;
	joinWithTicket: (ticket: string, displayName?: string) => Promise<JoinResult>;
	joinWithCode: (code: string, displayName?: string) => Promise<JoinResult>;
	createSyncProvider: (doc: Y.Doc, docId?: string, awareness?: Awareness | null) => P2PSyncProvider;
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
	const [reconnecting, setReconnecting] = useState(false);
	const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
	const [workspaceDeleted, setWorkspaceDeleted] = useState(false);
	// Read inside handlers: guests can now see other guests, so only the host may act on them
	const selfNameRef = useRef<string | null>(null);
	// Note catch-up steps run one at a time, so two updates to the same closed note cannot overwrite each other
	const catchUpQueueRef = useRef<Promise<void>>(Promise.resolve());
	const sendInventoryRef = useRef<(peerId: string) => void>(() => {});
	const [transfers, setTransfers] = useState<FileTransfer[]>([]);
	// Set when the user cancels everything, so a snapshot download loop stops instead of starting the next file
	const cancelledRef = useRef(false);
	const [handoffOffer, setHandoffOffer] = useState<HandoffOffer | null>(null);
	// The guest the host is waiting on to answer a handoff, and how to deliver the answer
	const handoffWaitRef = useRef<{ peerId: string; resolve: (ticket: string | null) => void } | null>(null);
	const [dataVersion, setDataVersion] = useState(0);
	const [selfNameVersion, setSelfNameVersion] = useState(0);
	const syncVersionRef = useRef(0);
	// Display name used for the most recent join, saved once we know the local workspace path
	const pendingSelfNameRef = useRef<string | null>(null);
	// Incoming changes are applied one at a time, in the order the peer sent them
	const applyQueueRef = useRef<Promise<void>>(Promise.resolve());

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

	// A host lists every guest that joins as a member with the role from their invite
	const addGuestMember = useCallback(async (peer: ConnectedPeerInfo) => {
		const path = workspaceRef.current?.path;
		if (!path) return;
		try {
			const meta = await readWorkspaceMetadata(path);
			const members = bindGuestMember(meta.members.members, peer);
			if (members === meta.members.members) return;
			await writeWorkspaceMetadata({ path, metadata: { ...meta, members: { members } } });
			await refreshMetadataRef.current(path);
		} catch (err) {
			console.error("[P2P] Failed to add the new collaborator as a member:", err);
		}
	}, []);

	// Track connected peers and attach them to live Yjs providers
	useEffect(() => {
		const updatePeers = (list: ConnectedPeerInfo[]) => {
			peersRef.current = list;
			setPeers(list);
		};
		p2p.listPeers().then(updatePeers).catch(() => {});

		const offPeers = p2p.onPeers(updatePeers);
		const offDataChanged = p2p.onDataChanged(() => {
			setDataVersion((v) => v + 1);
			void refreshMetadataRef.current();
		});
		const offJoinRequest = p2p.onJoinRequest((request) =>
			setJoinRequests((prev) => [...prev.filter((r) => r.requestId !== request.requestId), request]),
		);
		const offJoinRequestClosed = p2p.onJoinRequestClosed(({ requestId }) =>
			setJoinRequests((prev) => prev.filter((r) => r.requestId !== requestId)),
		);
		const offReconnecting = p2p.onReconnecting(() => setReconnecting(true));
		const offReconnectFailed = p2p.onReconnectFailed(() => setReconnecting(false));
		const offJoined = p2p.onPeerJoined((peer) => {
			setReconnecting(false);
			syncProvidersRef.current.forEach((provider) => provider.addPeer(peer.id));
			sendInventoryRef.current(peer.id);
			if (!peer.isHost && selfNameRef.current === null) void addGuestMember(peer);
		});
		const offLeft = p2p.onPeerLeft(({ peerId }) => {
			syncProvidersRef.current.forEach((provider) => provider.removePeer(peerId));
			pendingSnapshotsRef.current.delete(peerId);
		});
		return () => {
			offPeers();
			offJoined();
			offLeft();
			offJoinRequest();
			offJoinRequestClosed();
			offReconnecting();
			offReconnectFailed();
			offDataChanged();
		};
	}, [addGuestMember]);

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
				if (pendingSelfNameRef.current) {
					try {
						localStorage.setItem(selfNameKey(local.workspace.id), pendingSelfNameRef.current);
					} catch {
						// Only affects the "(You)" label
					}
					pendingSelfNameRef.current = null;
					setSelfNameVersion((v) => v + 1);
				}
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

				// Re-syncing updates existing rows and adds missing ones
				for (const task of snapshot.tasks ?? []) {
					await upsertTask(path, task).catch(() => {});
				}
				for (const column of snapshot.kanban ?? []) {
					await createKanbanColumn({ path, column }).catch(() => {});
					for (const card of column.cards ?? []) {
						await upsertKanbanCard(path, card).catch(() => {});
					}
				}
				setDataVersion((v) => v + 1);

				cancelledRef.current = false;
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
					if (cancelledRef.current) break;
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

	// Hosts share their member list so guests see everyone in the workspace
	const sendMembers = useCallback(
		(peerId?: string) => {
			const members = metadataRef.current?.members.members;
			if (!members) return;
			send({ kind: "MEMBERS_UPDATE", timestamp: Date.now(), payload: JSON.stringify(members) }, peerId);
		},
		[send],
	);

	// Notes open in an editor, whose live state is newer than what is stored
	const liveDocs = useCallback(
		() => [...syncProvidersRef.current].map((provider) => ({ docId: provider.docId, doc: provider.doc })),
		[],
	);

	const runCatchUp = useCallback((step: () => Promise<void>) => {
		catchUpQueueRef.current = catchUpQueueRef.current.then(step).catch((err) =>
			console.error("[P2P] Note catch-up failed:", err),
		);
	}, []);

	// Tell a peer what every note here looks like, so it can send what this device is missing
	sendInventoryRef.current = (peerId: string) => {
		const path = workspaceRef.current?.path;
		if (!path) return;
		runCatchUp(async () => {
			const inventory = await buildInventory(path, liveDocs());
			send({ kind: "YDOC_INVENTORY", timestamp: Date.now(), payload: JSON.stringify(inventory) }, peerId);
		});
	};

	// Tell collaborators about a local task/kanban edit
	const publishDataChange = useCallback(
		(change: DataChange) => {
			if (peersRef.current.length === 0) return;
			send({ kind: "DATA_CHANGE", timestamp: Date.now(), payload: JSON.stringify(change) });
		},
		[send],
	);

	// Handle an incoming app message from a peer
	const handleMessage = useCallback(
		async (peerId: string, message: P2PMessage) => {
			switch (message.kind) {
				case "SYNC_STEP_1":
				case "SYNC_STEP_2":
				case "SYNC_UPDATE":
				case "AWARENESS_UPDATE":
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
						// The requester may have been added as a member after the snapshot was read
						sendMembers(peerId);
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

				case "DATA_CHANGE": {
					const path = workspaceRef.current?.path;
					if (!path || !message.payload) break;
					try {
						const change: DataChange = JSON.parse(message.payload);
						await applyDataChange(path, change);
						setDataVersion((v) => v + 1);
					} catch (err) {
						console.error("[P2P] Failed to apply a collaborator's change:", err);
					}
					break;
				}

				case "WORKSPACE_DELETED":
					// The backend only delivers this from the host we joined
					setWorkspaceDeleted(true);
					break;

				case "YDOC_INVENTORY": {
					const path = workspaceRef.current?.path;
					if (!path || !message.payload) break;
					try {
						const inventory: Inventory = JSON.parse(message.payload);
						runCatchUp(async () => {
							for (const { docId, update } of await updatesFor(path, inventory, liveDocs())) {
								send({ kind: "YDOC_UPDATE", timestamp: Date.now(), docId, payload: update }, peerId);
							}
						});
					} catch {
						console.warn("[P2P] Ignoring a malformed note inventory.");
					}
					break;
				}

				case "YDOC_UPDATE": {
					const path = workspaceRef.current?.path;
					const { docId, payload } = message;
					if (!path || !docId || !payload) break;
					runCatchUp(async () => {
						const changed = await applyCatchUp(path, docId, base64ToUint8Array(payload), liveDocs());
						// Everyone else may now be missing what this device just learned.
						if (changed) {
							for (const peer of peersRef.current) if (peer.id !== peerId) sendInventoryRef.current(peer.id);
						}
					});
					break;
				}

				case "HOST_HANDOFF": {
					// The backend only delivers this from the host we joined
					try {
						const offer = JSON.parse(message.payload ?? "null");
						if (!isMemberList(offer?.members) || typeof offer.hostName !== "string") break;
						setHandoffOffer({ from: peerId, hostName: offer.hostName, members: offer.members });
					} catch {
						console.warn("[P2P] Ignoring a malformed host handoff.");
					}
					break;
				}

				case "HOST_READY": {
					// Only the guest the host is waiting on can answer
					const wait = handoffWaitRef.current;
					if (!wait || wait.peerId !== peerId) break;
					try {
						const { ticket } = JSON.parse(message.payload ?? "{}");
						wait.resolve(typeof ticket === "string" ? ticket : null);
					} catch {
						wait.resolve(null);
					}
					break;
				}

				case "HOST_MOVED": {
					// The backend only delivers this from the host we joined; follow it to the new host
					const workspaceId = workspaceRef.current?.id;
					try {
						const { ticket } = JSON.parse(message.payload ?? "{}");
						if (typeof ticket !== "string") break;
						const name = readSelfName(workspaceId) ?? "Collaborator";
						await p2p.disconnectPeer(peerId).catch(() => {});
						await p2p.joinWithTicket(ticket, name);
					} catch (err) {
						console.error("[P2P] Failed to follow the workspace to its new host:", err);
					}
					break;
				}

				case "ROLE_REQUEST": {
					// The backend only delivers this from an Admin guest, but what they may change is checked here
					const path = workspaceRef.current?.path;
					if (!path || !message.payload || selfNameRef.current !== null) break;
					try {
						const request: { deviceId?: unknown; role?: unknown } = JSON.parse(message.payload);
						if (typeof request.deviceId !== "string" || typeof request.role !== "string") break;
						const meta = await readWorkspaceMetadata(path);
						const members = meta.members.members;
						const actor = members.find((m) => m.deviceId === peerId);
						const target = members.find((m) => m.deviceId === request.deviceId);
						if (!actor || !target || !canChangeRole(actor.role, target.role, request.role)) break;
						const updated = members.map((m) => (m.id === target.id ? { ...m, role: request.role as string } : m));
						await writeWorkspaceMetadata({ path, metadata: { ...meta, members: { members: updated } } });
						await refreshMetadataRef.current(path);
					} catch (err) {
						console.error("[P2P] Failed to apply a role request:", err);
					}
					break;
				}

				case "MEMBERS_UPDATE": {
					// The backend only delivers this from the host we joined
					const path = workspaceRef.current?.path;
					if (!path || !message.payload) break;
					try {
						const members: unknown = JSON.parse(message.payload);
						if (!isMemberList(members)) break;
						const meta = await readWorkspaceMetadata(path);
						if (JSON.stringify(meta.members.members) === JSON.stringify(members)) break;
						await writeWorkspaceMetadata({ path, metadata: { ...meta, members: { members } } });
						await refreshMetadataRef.current(path);
					} catch (err) {
						console.error("[P2P] Failed to apply the member list:", err);
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
		[generateWorkspaceSnapshot, applyWorkspaceSnapshot, send, sendMembers, liveDocs, runCatchUp],
	);

	const handleMessageRef = useRef(handleMessage);
	handleMessageRef.current = handleMessage;

	useEffect(() => {
		return p2p.onMessage(({ peerId, message }) => {
			if (
				message.kind === "WORKSPACE_SYNC_REQUEST" ||
				message.kind.startsWith("SYNC_") ||
				message.kind === "AWARENESS_UPDATE"
			) {
				void handleMessageRef.current(peerId, message);
				return;
			}
			// Queue anything that writes to the workspace so a snapshot and later edits land in order
			applyQueueRef.current = applyQueueRef.current.then(() =>
				handleMessageRef.current(peerId, message),
			);
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

	// Track every download in flight so the UI can show progress and offer to cancel
	useEffect(() => {
		const offProgress = p2p.onFileProgress((event) =>
			setTransfers((prev) => [
				...prev.filter((t) => !(t.peerId === event.peerId && t.relPath === event.relPath)),
				{ peerId: event.peerId, relPath: event.relPath, receivedBytes: event.receivedBytes, totalBytes: event.totalBytes },
			]),
		);
		const offEnded = p2p.onFileEnded((event) =>
			setTransfers((prev) => prev.filter((t) => !(t.peerId === event.peerId && t.relPath === event.relPath))),
		);
		return () => {
			offProgress();
			offEnded();
		};
	}, []);

	const cancelTransfers = useCallback(async (relPath?: string) => {
		if (!relPath) cancelledRef.current = true;
		await p2p.cancelTransfers(relPath).catch(() => 0);
	}, []);

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

	// Create a 6-digit code that lasts 2 minutes and needs this host to allow the guest
	const createShortCode = useCallback(async (role: string = "Editor") => {
		const ws = workspaceRef.current;
		if (!ws) {
			throw new Error("Open a workspace before inviting collaborators.");
		}
		const owner = metadataRef.current?.members.members.find(
			(m) => m.role.toLowerCase() === "owner",
		);
		return p2p.createShortCode({
			role,
			workspaceId: ws.id,
			workspaceName: ws.name,
			hostName: owner?.name || "Host",
		});
	}, []);

	const resolveJoinRequest = useCallback(async (requestId: string, approve: boolean) => {
		setJoinRequests((prev) => prev.filter((r) => r.requestId !== requestId));
		await p2p.resolveJoinRequest(requestId, approve).catch(() => false);
	}, []);

	// Tell every guest the workspace is being deleted, then give the message time to arrive
	const announceWorkspaceDeleted = useCallback(async () => {
		await p2p.sendMessage({ kind: "WORKSPACE_DELETED", timestamp: Date.now() }).catch(() => 0);
		await new Promise((resolve) => setTimeout(resolve, 700));
	}, []);

	const dismissWorkspaceDeleted = useCallback(() => setWorkspaceDeleted(false), []);

	const revokeInvite = useCallback(async () => {
		setJoinRequests([]);
		await p2p.revokeInvite();
	}, []);

	// Connect to a host from an invite ticket
	const joinWithTicket = useCallback(async (ticket: string, displayName?: string) => {
		setIsJoining(true);
		try {
			const name =
				displayName?.trim() ||
				(await loadConfig().catch(() => null))?.display_name.trim() ||
				"Collaborator";
			const result = await p2p.joinWithTicket(ticket.trim(), name);
			pendingSelfNameRef.current = name;
			return result;
		} finally {
			setIsJoining(false);
		}
	}, []);

	// Connect to a host from a 6-digit code; resolves once the host allows the request
	const joinWithCode = useCallback(async (code: string, displayName?: string) => {
		setIsJoining(true);
		try {
			const name =
				displayName?.trim() ||
				(await loadConfig().catch(() => null))?.display_name.trim() ||
				"Collaborator";
			const result = await p2p.joinWithCode(code, name);
			pendingSelfNameRef.current = name;
			return result;
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
		(doc: Y.Doc, docId: string = "root", awareness: Awareness | null = null) => {
			const provider = new P2PSyncProvider(doc, (message, peerId) => send(message, peerId), docId, awareness);
			peersRef.current.forEach((peer) => provider.addPeer(peer.id));
			syncProvidersRef.current.add(provider);
			// A closed editor must leave the list, or catch-up would treat its stale document as open
			const destroy = provider.destroy.bind(provider);
			provider.destroy = () => {
				syncProvidersRef.current.delete(provider);
				destroy();
			};
			return provider;
		},
		[send],
	);

	const disconnectPeer = useCallback((peerId: string) => p2p.disconnectPeer(peerId), []);
	const disconnectAll = useCallback(() => p2p.disconnectAll(), []);

	// While hosting, push the member list to guests whenever it changes or someone joins
	const membersJson = JSON.stringify(metadata?.members.members ?? null);
	const guestCount = peers.filter((p) => !p.isHost).length;
	useEffect(() => {
		if (guestCount > 0 && membersJson !== "null" && selfNameRef.current === null) sendMembers();
	}, [membersJson, guestCount, sendMembers]);

	const selfName = useMemo(
		() => readSelfName(workspace?.id),
		// selfNameVersion changes when a join saves a new name for this workspace
		[workspace?.id, selfNameVersion],
	);
	selfNameRef.current = selfName;

	// The host enforces roles by device key, so it hands the current member list to the backend
	useEffect(() => {
		if (selfName !== null || membersJson === "null") return;
		p2p.setRoles(roleTable(JSON.parse(membersJson))).catch((err) =>
			console.error("[P2P] Failed to apply member roles:", err),
		);
	}, [membersJson, selfName]);

	// A joined copy identifies itself in the member list by its device key
	const [selfId, setSelfId] = useState<string | null>(null);
	useEffect(() => {
		if (selfName === null) return;
		p2p.selfId().then(setSelfId).catch(() => {});
	}, [selfName]);

	// Owner: offer hosting to a connected member, and once they are ready move everyone else to them
	const transferHost = useCallback(
		async (peerId: string) => {
			const ws = workspaceRef.current;
			if (!ws) throw new Error("Open a workspace first.");
			const meta = await readWorkspaceMetadata(ws.path);
			const owner = meta.members.members.find((m) => m.role === "Owner");
			const target = meta.members.members.find((m) => m.deviceId === peerId);
			if (!owner || !target) throw new Error("That collaborator isn't a member yet.");

			// The Owner becomes an Admin under their own device key; the chosen member becomes the Owner
			const selfDeviceId = await p2p.selfId();
			const members = meta.members.members.map((m) =>
				m.id === owner.id
					? { ...m, role: "Admin", deviceId: selfDeviceId }
					: m.id === target.id
						? { ...m, role: "Owner" }
						: m,
			);

			const ticket = await new Promise<string | null>((resolve, reject) => {
				const timer = setTimeout(() => {
					handoffWaitRef.current = null;
					reject(new Error(`${target.name} didn't answer in time.`));
				}, HANDOFF_TIMEOUT_MS);
				handoffWaitRef.current = {
					peerId,
					resolve: (t) => {
						clearTimeout(timer);
						handoffWaitRef.current = null;
						resolve(t);
					},
				};
				send(
					{ kind: "HOST_HANDOFF", timestamp: Date.now(), payload: JSON.stringify({ members, hostName: owner.name }) },
					peerId,
				);
			});
			if (!ticket) throw new Error(`${target.name} declined to become the host.`);

			await writeWorkspaceMetadata({ path: ws.path, metadata: { ...meta, members: { members } } });
			// Everyone else follows the new host, then this device joins it as a guest too
			for (const peer of peersRef.current) {
				if (peer.id !== peerId && !peer.isHost) {
					send({ kind: "HOST_MOVED", timestamp: Date.now(), payload: JSON.stringify({ ticket }) }, peer.id);
				}
			}
			await sleep(700);
			setSelfName(ws.id, owner.name);
			setSelfNameVersion((v) => v + 1);
			await p2p.disconnectAll();
			await p2p.joinWithTicket(ticket, owner.name);
			await refreshMetadataRef.current(ws.path);
		},
		[send],
	);

	// Guest: take over hosting from the current host, then hand them a fresh invite to join
	const acceptHandoff = useCallback(async () => {
		const offer = handoffOffer;
		const ws = workspaceRef.current;
		if (!offer || !ws) return;
		try {
			const newOwner = offer.members.find((m) => m.role === "Owner");
			const invite = await p2p.createInvite({
				role: "Editor",
				workspaceId: ws.id,
				workspaceName: ws.name,
				hostName: newOwner?.name || "Host",
			});
			const meta = await readWorkspaceMetadata(ws.path);
			await writeWorkspaceMetadata({ path: ws.path, metadata: { ...meta, members: { members: offer.members } } });
			await p2p.setRoles(roleTable(offer.members));
			setSelfName(ws.id, null);
			setSelfNameVersion((v) => v + 1);
			await refreshMetadataRef.current(ws.path);
			send({ kind: "HOST_READY", timestamp: Date.now(), payload: JSON.stringify({ ticket: invite.ticket }) }, offer.from);
			// Let the ticket arrive before leaving the old host, whose link would otherwise be retried
			await sleep(500);
			await p2p.disconnectPeer(offer.from).catch(() => {});
		} catch (err) {
			send({ kind: "HOST_READY", timestamp: Date.now(), payload: "{}" }, offer.from);
			throw err;
		} finally {
			setHandoffOffer(null);
		}
	}, [handoffOffer, send]);

	const declineHandoff = useCallback(() => {
		if (handoffOffer) send({ kind: "HOST_READY", timestamp: Date.now(), payload: "{}" }, handoffOffer.from);
		setHandoffOffer(null);
	}, [handoffOffer, send]);

	// An Admin guest asks the host to change a role; the host decides
	const requestRoleChange = useCallback(
		(deviceId: string, role: string) =>
			send({ kind: "ROLE_REQUEST", timestamp: Date.now(), payload: JSON.stringify({ deviceId, role }) }),
		[send],
	);

	const connectionStatus: P2PContextType["connectionStatus"] =
		peers.length > 0 ? "connected"
		: reconnecting ? "reconnecting"
		: isJoining ? "connecting"
		: "offline";

	return (
		<P2PContext.Provider
			value={{
				peers,
				connectionStatus,
				placeholders,
				syncProgress,
				lastSyncedFile,
				dataVersion,
				selfName,
				selfId,
				requestRoleChange,
				transfers,
				cancelTransfers,
				handoffOffer,
				acceptHandoff,
				declineHandoff,
				transferHost,
				publishDataChange,
				createInvite,
				createShortCode,
				joinRequests,
				resolveJoinRequest,
				workspaceDeleted,
				dismissWorkspaceDeleted,
				announceWorkspaceDeleted,
				revokeInvite,
				joinWithTicket,
				joinWithCode,
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

// The role this device holds here: Owner in its own workspaces, otherwise what the host assigned it
export function useSelfRole(): string {
	const { metadata } = useWorkspace();
	const { selfName, selfId } = useP2P();
	if (selfName === null) return "Owner";
	const members = metadata?.members.members ?? [];
	const me = members.find((m) => (selfId ? m.deviceId === selfId : m.name === selfName));
	return me?.role ?? "Viewer";
}

// True if this device joined someone else's workspace with the Viewer role
export function useIsViewer(): boolean {
	return useSelfRole() === "Viewer";
}
