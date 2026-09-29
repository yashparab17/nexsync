import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";

// Each fake device keeps its stored documents in memory, keyed by workspace path
const stores = new Map<string, Map<string, Uint8Array>>();
const store = (path: string) => stores.get(path) ?? stores.set(path, new Map()).get(path)!;

vi.mock("@/lib/tauri", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/tauri")>()),
	getYjsDoc: async (path: string, id: string) => store(path).get(id) ?? null,
	saveYjsDoc: async (path: string, id: string, state: Uint8Array) => void store(path).set(id, state),
	listYjsDocs: async (path: string) => [...store(path).keys()],
}));

import { applyCatchUp, buildInventory, updatesFor } from "./yjsCatchUp";
import { base64ToUint8Array } from "@/lib/tauri";

function text(path: string, id: string): string {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, store(path).get(id)!);
	return doc.getText("t").toString();
}

// One round: `to` receives whatever `from` has that it lacks
async function exchange(from: string, to: string) {
	const inventory = await buildInventory(to, []);
	let changed = 0;
	for (const { docId, update } of await updatesFor(from, inventory, [])) {
		if (await applyCatchUp(to, docId, base64ToUint8Array(update), [])) changed++;
	}
	return changed;
}

describe("Yjs catch-up", () => {
	it("merges edits and deletions made to closed notes while apart", async () => {
		const base = new Y.Doc();
		base.getText("t").insert(0, "hello world");
		const start = Y.encodeStateAsUpdate(base);
		for (const path of ["A", "B"]) store(path).set("notes/a.md", start);

		// A types, B only deletes; neither opens the note in an editor.
		const a = new Y.Doc();
		Y.applyUpdate(a, start);
		a.getText("t").insert(5, "!");
		store("A").set("notes/a.md", Y.encodeStateAsUpdate(a));
		const b = new Y.Doc();
		Y.applyUpdate(b, start);
		b.getText("t").delete(5, 6);
		store("B").set("notes/a.md", Y.encodeStateAsUpdate(b));
		// A note that only A has
		const only = new Y.Doc();
		only.getText("t").insert(0, "only on A");
		store("A").set("notes/only.md", Y.encodeStateAsUpdate(only));

		expect(await exchange("A", "B")).toBe(2);
		expect(await exchange("B", "A")).toBe(1);

		expect(text("A", "notes/a.md")).toBe("hello!");
		expect(text("B", "notes/a.md")).toBe("hello!");
		expect(text("B", "notes/only.md")).toBe("only on A");

		// Once they agree, another round sends nothing.
		expect(await exchange("A", "B")).toBe(0);
		expect(await exchange("B", "A")).toBe(0);
	});

	it("applies an update to an open document instead of the stored copy", async () => {
		const open = new Y.Doc();
		open.getText("t").insert(0, "typing");
		const other = new Y.Doc();
		Y.applyUpdate(other, Y.encodeStateAsUpdate(open));
		other.getText("t").insert(6, " more");

		const changed = await applyCatchUp("C", "notes/open.md", Y.encodeStateAsUpdate(other), [{ docId: "notes/open.md", doc: open }]);
		expect(changed).toBe(true);
		expect(open.getText("t").toString()).toBe("typing more");
		expect(store("C").has("notes/open.md")).toBe(false);
	});
});
