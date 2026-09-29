import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

// Only the bridge to Rust is faked. Events the backend would emit are delivered by hand.
const listeners = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
	listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
		listeners.set(name, handler);
		return () => listeners.delete(name);
	},
}));

const invoke = vi.fn(async (command: string, _args?: unknown) => {
	if (command === "p2p_list_peers") {
		return [{ id: "guest-1", name: "Ann", role: "Editor", isHost: true, connectionType: "direct" }];
	}
	if (command.startsWith("list_") || command.startsWith("get_")) return [];
	return null;
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args?: unknown) => invoke(command, args) }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/tauri")>()),
	receiveNamedVersion: vi.fn(async () => true),
}));

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

import { receiveNamedVersion } from "@/lib/tauri";
import { P2PProvider, useP2P } from "./P2PContext";

let api: ReturnType<typeof useP2P>;
function Probe() {
	api = useP2P();
	return null;
}

const deliver = (message: Record<string, unknown>) =>
	act(async () => {
		listeners.get("p2p://message")?.({ payload: { peerId: "guest-1", message: { timestamp: 1, ...message } } });
		await Promise.resolve();
	});

beforeEach(async () => {
	render(
		<P2PProvider>
			<Probe />
		</P2PProvider>,
	);
	await waitFor(() => expect(listeners.has("p2p://message")).toBe(true));
});
afterEach(() => {
	cleanup();
	listeners.clear();
	vi.clearAllMocks();
});

describe("named versions over P2P", () => {
	it("keeps a version a collaborator named, credited to who the backend says sent it", async () => {
		await deliver({
			kind: "VERSION_NAMED",
			author: "Ann",
			payload: JSON.stringify({ path: "/notes/a.md", label: "Agreed draft", content: "text" }),
		});
		await waitFor(() => expect(receiveNamedVersion).toHaveBeenCalledWith("/w", "notes/a.md", "text", "Agreed draft", "Ann"));
	});

	it("credits a message without an author to a collaborator", async () => {
		await deliver({ kind: "VERSION_NAMED", payload: JSON.stringify({ path: "notes/a.md", label: "L", content: "c" }) });
		await waitFor(() => expect(receiveNamedVersion).toHaveBeenCalledWith("/w", "notes/a.md", "c", "L", "A collaborator"));
	});

	it("ignores a message that is not a named version", async () => {
		await deliver({ kind: "VERSION_NAMED", payload: JSON.stringify({ path: "notes/a.md", label: 5 }) });
		await deliver({ kind: "VERSION_NAMED", payload: "not json" });
		await deliver({ kind: "VERSION_NAMED" });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(receiveNamedVersion).not.toHaveBeenCalled();
	});

	it("sends a named version to connected collaborators", async () => {
		await waitFor(() => expect(api.peers.length).toBe(1));
		expect(api.shareNamedVersion("notes/a.md", "Agreed draft", "text")).toBe(true);
		await waitFor(() => expect(invoke).toHaveBeenCalledWith("p2p_send", expect.anything()));
		const sent = invoke.mock.calls.find((call) => call[0] === "p2p_send")![1] as { message: { kind: string; payload: string } };
		expect(sent.message.kind).toBe("VERSION_NAMED");
		expect(JSON.parse(sent.message.payload)).toEqual({ path: "notes/a.md", label: "Agreed draft", content: "text" });
	});

	it("does not try to send a version that is too large for one message", async () => {
		await waitFor(() => expect(api.peers.length).toBe(1));
		expect(api.shareNamedVersion("notes/a.md", "Big", "x".repeat(4 * 1024 * 1024 + 1))).toBe(false);
		expect(invoke).not.toHaveBeenCalledWith("p2p_send", expect.anything());
	});
});
