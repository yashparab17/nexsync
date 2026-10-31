import { describe, expect, it } from "vitest";

import { connectionView, type ConnectionInput } from "@/lib/p2p/connectionState";

const base: ConnectionInput = { online: true, status: "offline", connected: 0, link: "none", hostName: null, hostUnreachable: false, syncing: false };
const view = (o: Partial<ConnectionInput>) => connectionView({ ...base, ...o });

describe("connection button", () => {
	it("says nothing when things are fine, whether or not anyone is there", () => {
		expect(view({})).toMatchObject({ key: "idle", label: "" });
		expect(view({ status: "connected", connected: 2, link: "host", hostName: "Ana" })).toMatchObject({ key: "connected", tone: "ok", label: "" });
	});

	it("says the host is away when a joined copy works with the other members, or alone", () => {
		expect(view({ status: "connected", connected: 2, link: "members", hostName: "Ana" })).toMatchObject({ key: "host-away-members", label: "Host away", tone: "warn" });
		expect(view({ hostName: "Ana", hostUnreachable: true })).toMatchObject({ key: "host-away-alone", label: "Host away" });
		expect(view({ hostName: "Ana", hostUnreachable: true }).title).toContain("Your copy keeps working");
	});

	it("does not call it a host problem in a workspace of your own", () => {
		expect(view({ status: "connected", connected: 1, link: "members" }).key).toBe("connected");
	});

	it("puts no internet first, then syncing, then connecting", () => {
		expect(view({ online: false, hostName: "Ana", hostUnreachable: true }).key).toBe("offline");
		expect(view({ syncing: true, status: "connected", connected: 1 }).key).toBe("syncing");
		expect(view({ status: "reconnecting" })).toMatchObject({ key: "connecting", label: "Reconnecting" });
	});
});
