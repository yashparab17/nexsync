import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

import { P2PSyncProvider } from "./P2PSyncProvider";

// Two devices wired together in memory; a message to a device whose editor is not open yet is simply lost, as it is live
function device(name: string, net: Map<string, P2PSyncProvider>, text = "") {
	const doc = new Y.Doc();
	if (text) doc.getText("content").insert(0, text);
	const awareness = new Awareness(doc);
	const provider = new P2PSyncProvider(doc, (message, to) => net.get(to)?.handleMessage(name, message), "notes/x.md", awareness);
	net.set(name, provider);
	return { doc, provider, awareness };
}

describe("P2PSyncProvider handshake", () => {
	it("gives both sides everything even when one editor opens after the other has already asked", () => {
		const net = new Map<string, P2PSyncProvider>();
		const a = device("a", net, "from a. ");
		a.provider.addPeer("b"); // b has no editor open yet, so this request is lost
		const b = device("b", net, "from b. ");
		b.provider.addPeer("a");
		const [x, y] = [a.doc.getText("content").toString(), b.doc.getText("content").toString()];
		expect(x).toBe(y);
		expect(x).toContain("from a. ");
		expect(x).toContain("from b. ");
	});

	it("shows a cursor that was already there when the other editor opened", () => {
		const net = new Map<string, P2PSyncProvider>();
		const a = device("a", net, "text");
		a.awareness.setLocalStateField("user", { name: "Ana" });
		a.provider.addPeer("b");
		const b = device("b", net);
		b.provider.addPeer("a");
		expect([...b.awareness.getStates().values()].some((s) => (s as { user?: { name: string } }).user?.name === "Ana")).toBe(true);
	});

	it("stops asking: two editors that open together exchange a bounded number of messages", () => {
		const net = new Map<string, P2PSyncProvider>();
		let count = 0;
		const make = (name: string) => {
			const doc = new Y.Doc();
			const p = new P2PSyncProvider(doc, (m, to) => {
				count++;
				net.get(to)?.handleMessage(name, m);
			}, "notes/x.md");
			net.set(name, p);
			return { doc, p };
		};
		const a = make("a");
		const b = make("b");
		a.p.addPeer("b");
		b.p.addPeer("a");
		expect(count).toBeLessThan(20);
		expect(a.doc.getText("content").toString()).toBe(b.doc.getText("content").toString());
	});
});
