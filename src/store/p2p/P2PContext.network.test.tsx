import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const listeners = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
	listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
		listeners.set(name, handler);
		return () => listeners.delete(name);
	},
}));

const invoke = vi.fn(async (command: string, _args?: unknown) => {
	if (command === "p2p_network_status") return { online: true, detail: null };
	if (command.startsWith("list_") || command.startsWith("get_") || command === "p2p_list_peers") return [];
	return null;
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args?: unknown) => invoke(command, args) }));

vi.mock("@/store/workspace/WorkspaceContext", () => ({
	subscribeToActivityEvents: () => () => {},
	useWorkspace: () => ({
		workspace: { path: "/w", id: "1", name: "W" },
		metadata: null,
		refreshMetadata: async () => {},
		refreshStats: async () => {},
		addActivityEvent: () => {},
	}),
}));

import { P2PProvider, useP2P } from "./P2PContext";

let api: ReturnType<typeof useP2P>;
function Probe() {
	api = useP2P();
	return null;
}

beforeEach(async () => {
	render(
		<P2PProvider>
			<Probe />
		</P2PProvider>,
	);
	await waitFor(() => expect(listeners.has("p2p://network")).toBe(true));
});
afterEach(() => {
	cleanup();
	listeners.clear();
	vi.clearAllMocks();
});

describe("network status", () => {
	it("shows offline the moment the OS says so, without waiting for the relay", async () => {
		act(() => {
			window.dispatchEvent(new Event("offline"));
		});
		expect(api.network.online).toBe(false);
	});

	it("follows the relay status the backend reports, including why it is unreachable", async () => {
		act(() => {
			listeners.get("p2p://network")?.({ payload: { online: false, detail: "connection refused" } });
		});
		expect(api.network).toEqual({ online: false, detail: "connection refused" });
		act(() => {
			listeners.get("p2p://network")?.({ payload: { online: true, detail: null } });
		});
		expect(api.network.online).toBe(true);
	});

	it("makes the backend re-probe when the OS reports the network is back", async () => {
		act(() => {
			window.dispatchEvent(new Event("online"));
		});
		await waitFor(() => expect(invoke).toHaveBeenCalledWith("p2p_network_change", undefined));
	});
});
