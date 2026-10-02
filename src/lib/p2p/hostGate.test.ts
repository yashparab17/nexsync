import { describe, expect, it } from "vitest";

import { hostGateOf, linkOf, type HostGateInput } from "@/lib/p2p/hostGate";

const base: HostGateInput = { joined: true, required: true, hasHost: false, trying: false, failed: false, canRetry: true };

describe("how a copy is connected", () => {
	it("tells the host from other members, and from nobody", () => {
		expect(linkOf([])).toBe("none");
		expect(linkOf([{ isHost: false }, { isHost: false }])).toBe("members");
		expect(linkOf([{ isHost: false }, { isHost: true }])).toBe("host");
	});
});

describe("requiring the host", () => {
	it("lets the host's own copy, and workspaces that do not require it, work as normal", () => {
		expect(hostGateOf({ ...base, joined: false })).toBe("ok");
		expect(hostGateOf({ ...base, required: false })).toBe("ok");
	});

	it("lets a guest work while the host is connected, even if other guests are all that is left", () => {
		expect(hostGateOf({ ...base, hasHost: true })).toBe("ok");
	});

	it("holds the screen while the host is being reached, then says it is offline once that fails", () => {
		expect(hostGateOf({ ...base, trying: true })).toBe("connecting");
		expect(hostGateOf(base)).toBe("connecting"); // about to try
		expect(hostGateOf({ ...base, failed: true })).toBe("offline");
	});

	it("does not wait for a host it has no way to find", () => {
		expect(hostGateOf({ ...base, canRetry: false })).toBe("offline");
	});
});
