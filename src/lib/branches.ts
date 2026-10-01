// Branches of a file, kept as ordinary CRDT documents.
//
// A branch is a copy of the file's shared document that people can edit without touching the file. Because the copy
// starts from the file's full history, merging it back is not a text merge: applying its updates to the file's document
// adds exactly the operations made on the branch, wherever they sit, and gives the same result whatever order several
// branches are merged in. A merge is therefore reviewed before it is made: the preview is the file's text with the
// branch's operations applied to a throwaway copy.
//
// The list of branches lives inside the file's own document (a map named "branches"), so it reaches collaborators and
// is stored with the file; each branch's content is a separate document under its own id, which the existing catch-up
// already syncs between devices.

import * as Y from "yjs";

export type BranchStatus = "open" | "merged" | "closed";

export interface Branch {
	id: string;
	name: string;
	by: string;
	at: number; // Milliseconds since 1970
	status: BranchStatus;
	closedBy?: string;
	closedAt?: number;
}

export const MAX_BRANCH_NAME = 60;
export const branchDocId = (id: string) => `branch:${id}`;

const branchesOf = (doc: Y.Doc) => doc.getMap<Branch>("branches");

// The map is shared, so what is in it came from other people's devices
function isBranch(value: unknown): value is Branch {
	const b = value as Partial<Branch> | null;
	return (
		!!b &&
		typeof b.id === "string" &&
		typeof b.name === "string" &&
		typeof b.by === "string" &&
		typeof b.at === "number" &&
		(b.status === "open" || b.status === "merged" || b.status === "closed")
	);
}

// Open branches first, newest first within each group
export function listBranches(doc: Y.Doc): Branch[] {
	return [...branchesOf(doc).values()]
		.filter(isBranch)
		.sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || b.at - a.at);
}

// Forks the document: returns the state the branch's own document starts from, and records the branch in the file
export function startBranch(main: Y.Doc, name: string, by: string, id: string = crypto.randomUUID(), now = Date.now()): { branch: Branch; state: Uint8Array } {
	const clean = name.trim().slice(0, MAX_BRANCH_NAME);
	if (!clean) throw new Error("Give the branch a name.");
	// The state is taken first, so the copy does not hold the record of its own branch
	const state = Y.encodeStateAsUpdate(main);
	const branch: Branch = { id, name: clean, by, at: now, status: "open" };
	branchesOf(main).set(id, branch);
	return { branch, state };
}

// What the file would read after the merge, from a throwaway copy of the file's document
export function previewMerge(main: Y.Doc, branchState: Uint8Array, key = "content"): { before: string; after: string } {
	const copy = new Y.Doc();
	Y.applyUpdate(copy, Y.encodeStateAsUpdate(main));
	const before = copy.getText(key).toString();
	Y.applyUpdate(copy, branchState);
	return { before, after: copy.getText(key).toString() };
}

// Adds the branch's operations to the file's document. Applied as an update, so editors treat it like a collaborator's
// change (and warn if it breaks code), and it reaches everyone else like any other change.
export function mergeBranch(main: Y.Doc, branch: Branch, branchState: Uint8Array, by: string, now = Date.now()): void {
	Y.applyUpdate(main, branchState, "branch-merge");
	branchesOf(main).set(branch.id, { ...branch, status: "merged", closedBy: by, closedAt: now });
}

export function closeBranch(main: Y.Doc, branch: Branch, by: string, now = Date.now()): void {
	branchesOf(main).set(branch.id, { ...branch, status: "closed", closedBy: by, closedAt: now });
}
