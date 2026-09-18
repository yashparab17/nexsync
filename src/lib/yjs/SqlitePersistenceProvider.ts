// SQLite Persistence Provider for Yjs CRDT Documents
// Handles automatic debounced synchronization between in-memory Y.Doc instances and local SQLite database

import * as Y from "yjs";
import { getYjsDoc, saveYjsDoc, deleteYjsDoc } from "@/lib/tauri";

export interface SqlitePersistenceOptions {
	// Debounce interval in milliseconds before persisting updates to SQLite (default: 500ms)
	debounceMs?: number;
}

export type PersistenceStatus = "loading" | "synced" | "saving" | "error" | "destroyed";
type StatusListener = (status: PersistenceStatus) => void;
type SyncedListener = () => void;

// Custom Yjs persistence provider backing documents to SQLite via Tauri IPC
export class SqlitePersistenceProvider {
	public readonly workspacePath: string;
	public readonly docId: string;
	public readonly doc: Y.Doc;
	public synced: boolean = false;
	public destroyed: boolean = false;

	private readonly debounceMs: number;
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;
	private status: PersistenceStatus = "loading";
	private statusListeners: Set<StatusListener> = new Set();
	private syncedListeners: Set<SyncedListener> = new Set();
	private pendingSavePromise: Promise<void> | null = null;
	public readonly whenSynced: Promise<void>;

	constructor(
		workspacePath: string,
		docId: string,
		doc: Y.Doc,
		options: SqlitePersistenceOptions = {},
	) {
		this.workspacePath = workspacePath;
		this.docId = docId;
		this.doc = doc;
		this.debounceMs = options.debounceMs ?? 500;

		// Bind update listener
		this.doc.on("update", this.handleDocUpdate);

		// Kick off initial document load
		this.whenSynced = this.loadInitialDoc();
	}

	// Loads binary CRDT state from SQLite and applies it to the Y.Doc
	private async loadInitialDoc(): Promise<void> {
		if (this.destroyed) return;

		this.setStatus("loading");
		try {
			const binaryState = await getYjsDoc(this.workspacePath, this.docId);

			if (binaryState && binaryState.length > 0 && !this.destroyed) {
				// Apply update using this instance as origin so we do not trigger an immediate re-save
				Y.applyUpdate(this.doc, binaryState, this);
			}

			if (!this.destroyed) {
				this.synced = true;
				this.setStatus("synced");
				this.syncedListeners.forEach((listener) => {
					try {
						listener();
					} catch (err) {
						console.error("[SqlitePersistenceProvider] Error in synced listener:", err);
					}
				});
			}
		} catch (error) {
			console.error(`[SqlitePersistenceProvider] Failed to load doc "${this.docId}":`, error);
			if (!this.destroyed) {
				this.setStatus("error");
			}
		}
	}

	// Handles document updates from editor or remote peers
	private handleDocUpdate = (_update: Uint8Array, origin: unknown) => {
		// Ignore updates triggered by this provider during initial load
		if (origin === this || this.destroyed) {
			return;
		}

		this.scheduleSave();
	};

	// Schedules a debounced save operation
	private scheduleSave(): void {
		if (this.destroyed) return;

		if (this.saveTimeout !== null) {
			clearTimeout(this.saveTimeout);
		}

		this.saveTimeout = setTimeout(() => {
			this.saveTimeout = null;
			this.saveNow().catch((err) => {
				console.error(`[SqlitePersistenceProvider] Save error for "${this.docId}":`, err);
			});
		}, this.debounceMs);
	}

	// Immediately persists current binary document state to SQLite
	public async saveNow(): Promise<void> {
		if (this.destroyed) return;

		if (this.saveTimeout !== null) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}

		if (this.pendingSavePromise) {
			return this.pendingSavePromise;
		}

		this.setStatus("saving");

		this.pendingSavePromise = (async () => {
			try {
				const state = Y.encodeStateAsUpdate(this.doc);
				await saveYjsDoc(this.workspacePath, this.docId, state);
				if (!this.destroyed) {
					this.setStatus("synced");
				}
			} catch (error) {
				console.error(`[SqlitePersistenceProvider] Failed to persist doc "${this.docId}":`, error);
				if (!this.destroyed) {
					this.setStatus("error");
				}
				throw error;
			} finally {
				this.pendingSavePromise = null;
			}
		})();

		return this.pendingSavePromise;
	}

	// Flushes any scheduled debounced save immediately
	public async flush(): Promise<void> {
		if (this.saveTimeout !== null) {
			await this.saveNow();
		} else if (this.pendingSavePromise) {
			await this.pendingSavePromise;
		}
	}

	// Deletes the binary document snapshot from SQLite
	public async clear(): Promise<void> {
		if (this.saveTimeout !== null) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
		await deleteYjsDoc(this.workspacePath, this.docId);
	}

	// Unbinds listeners, flushes pending state, and destroys provider instance
	public async destroy(): Promise<void> {
		if (this.destroyed) return;
		this.destroyed = true;

		this.doc.off("update", this.handleDocUpdate);

		if (this.saveTimeout !== null) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
			// Attempt a final synchronous-like save before destroying
			try {
				const state = Y.encodeStateAsUpdate(this.doc);
				await saveYjsDoc(this.workspacePath, this.docId, state);
			} catch (err) {
				console.error(`[SqlitePersistenceProvider] Final flush failed during destroy for "${this.docId}":`, err);
			}
		}

		this.statusListeners.clear();
		this.syncedListeners.clear();
		this.setStatus("destroyed");
	}

	// Returns the current sync status
	public getStatus(): PersistenceStatus {
		return this.status;
	}

	// Subscribes to status changes (loading, synced, saving, error, destroyed)
	public onStatusChange(listener: StatusListener): () => void {
		this.statusListeners.add(listener);
		listener(this.status);
		return () => {
			this.statusListeners.delete(listener);
		};
	}

	// Subscribes to initial sync completion
	public onSynced(listener: SyncedListener): () => void {
		if (this.synced) {
			listener();
		} else {
			this.syncedListeners.add(listener);
		}
		return () => {
			this.syncedListeners.delete(listener);
		};
	}

	// Updates internal status and alerts subscribers
	private setStatus(status: PersistenceStatus) {
		this.status = status;
		this.statusListeners.forEach((listener) => {
			try {
				listener(status);
			} catch (err) {
				console.error("[SqlitePersistenceProvider] Error in status listener:", err);
			}
		});
	}
}
