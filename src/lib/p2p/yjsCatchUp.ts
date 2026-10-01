// Catch-up for note documents: when two devices meet, each says what it has and the other sends what is missing.
// Notes open in the editor already sync live, so this covers the ones closed while the devices were apart.

import * as Y from "yjs";

import { addTextCatchup, base64ToUint8Array, getYjsDoc, listYjsDocs, saveYjsDoc, uint8ArrayToBase64 } from "@/lib/tauri";

// A document open in the editor; its in-memory state is newer than what is stored
export interface LiveDoc {
	docId: string;
	doc: Y.Doc;
}

// What one side knows about a document: its state vector and a digest of the whole state including deletions
export interface InventoryEntry {
	sv: string;
	digest: string;
}

export type Inventory = Record<string, InventoryEntry>;

// Limits what a peer can make this device store or compute
const MAX_DOCS = 5000;

// Two documents with the same digest hold identical content, deletions included
async function digestOf(doc: Y.Doc): Promise<string> {
	const bytes = Y.encodeSnapshot(Y.snapshot(doc));
	if (!globalThis.crypto?.subtle) return uint8ArrayToBase64(bytes);
	const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
	return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

// The open document if there is one, otherwise the stored state loaded into a scratch document
async function load(path: string, docId: string, live: LiveDoc[]): Promise<{ doc: Y.Doc; isLive: boolean }> {
	const open = live.find((l) => l.docId === docId);
	if (open) return { doc: open.doc, isLive: true };
	const doc = new Y.Doc();
	const stored = await getYjsDoc(path, docId);
	if (stored && stored.length > 0) Y.applyUpdate(doc, stored);
	return { doc, isLive: false };
}

async function allDocIds(path: string, live: LiveDoc[]): Promise<string[]> {
	const stored = await listYjsDocs(path);
	return [...new Set([...stored, ...live.map((l) => l.docId)])].slice(0, MAX_DOCS);
}

// ponytail: loads every stored note on each connect; keep a cached digest per doc if workspaces get large.
export async function buildInventory(path: string, live: LiveDoc[]): Promise<Inventory> {
	const inventory: Inventory = {};
	for (const docId of await allDocIds(path, live)) {
		const { doc, isLive } = await load(path, docId, live);
		inventory[docId] = { sv: uint8ArrayToBase64(Y.encodeStateVector(doc)), digest: await digestOf(doc) };
		if (!isLive) doc.destroy();
	}
	return inventory;
}

// What the peer is missing, given the inventory it sent: one update per document that differs
export async function updatesFor(
	path: string,
	remote: Inventory,
	live: LiveDoc[],
): Promise<{ docId: string; update: string }[]> {
	const updates: { docId: string; update: string }[] = [];
	for (const docId of await allDocIds(path, live)) {
		const { doc, isLive } = await load(path, docId, live);
		const theirs = remote[docId];
		const empty = Y.encodeStateVector(doc).length <= 1;
		if (!empty && (!theirs || theirs.digest !== (await digestOf(doc)))) {
			const sv = theirs ? base64ToUint8Array(theirs.sv) : undefined;
			updates.push({ docId, update: uint8ArrayToBase64(Y.encodeStateAsUpdate(doc, sv)) });
		}
		if (!isLive) doc.destroy();
	}
	return updates;
}

// Merges a peer's update into a document; returns true if that changed it. A change to the text is written down for the
// catch-up review, with who made it when known (a branch is somebody's draft and is not reported).
export async function applyCatchUp(path: string, docId: string, update: Uint8Array, live: LiveDoc[], who: string | null = null): Promise<boolean> {
	const { doc, isLive } = await load(path, docId, live);
	const before = await digestOf(doc);
	const textBefore = doc.getText("content").toString();
	Y.applyUpdate(doc, update, "catch-up");
	const changed = before !== (await digestOf(doc));
	// An open document is saved by its own persistence provider; a closed one is saved here.
	if (changed && !isLive) await saveYjsDoc(path, docId, Y.encodeStateAsUpdate(doc));
	const textAfter = doc.getText("content").toString();
	if (changed && textBefore !== textAfter && !docId.startsWith("branch:")) {
		// Reviewing is optional, so failing to note a change must never stop it from being applied
		void Promise.resolve()
			.then(() => addTextCatchup(path, docId, docId.split("/").pop() || docId, who, textBefore, textAfter))
			.catch(() => {});
	}
	if (!isLive) doc.destroy();
	return changed;
}

// Changes a document that may be open in the editor or only stored; `edit` says whether it changed anything.
// An open document is saved by its own provider and reaches collaborators live; a stored one is saved here.
export async function editDoc(path: string, docId: string, live: LiveDoc[], edit: (doc: Y.Doc) => boolean): Promise<boolean> {
	const { doc, isLive } = await load(path, docId, live);
	const changed = edit(doc);
	if (changed && !isLive) await saveYjsDoc(path, docId, Y.encodeStateAsUpdate(doc));
	if (!isLive) doc.destroy();
	return changed;
}
