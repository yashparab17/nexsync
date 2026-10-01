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

// What get_tasks returns, so a test can say the task was already assigned to us
let storedTasks: unknown[] = [];
const invoke = vi.fn(async (command: string, _args?: unknown) => {
	if (command === "get_tasks") return storedTasks;
	if (command === "p2p_list_peers") return [];
	if (command.startsWith("list_") || command.startsWith("get_")) return [];
	return null;
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args?: unknown) => invoke(command, args) }));

vi.mock("@/store/workspace/WorkspaceContext", () => ({
	subscribeToActivityEvents: () => () => {},
	useWorkspace: () => ({
		workspace: { path: "/w", id: "1", name: "W" },
		metadata: { members: { members: [{ id: "me", name: "Yash", role: "Owner" }] } },
		refreshMetadata: async () => {},
		refreshStats: async () => {},
		addActivityEvent: () => {},
	}),
}));

import { NotificationProvider, useNotifications } from "@/store/notifications/NotificationContext";
import { P2PProvider } from "./P2PContext";

let notifications: ReturnType<typeof useNotifications>;
function Probe() {
	notifications = useNotifications();
	return null;
}

const task = (assignee?: string) => ({
	id: "t1",
	title: "Ship it",
	description: "",
	status: "todo",
	priority: "medium",
	assignee_id: assignee,
	tags: [],
	created_at: "t",
	updated_at: "t",
});
const change = (assignee?: string) =>
	act(async () => {
		listeners.get("p2p://message")?.({
			payload: {
				peerId: "guest-1",
				message: { kind: "DATA_CHANGE", timestamp: 1, author: "Ann", payload: JSON.stringify({ entity: "task", op: "upsert", task: task(assignee) }) },
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
	});

beforeEach(async () => {
	storedTasks = [];
	render(
		<NotificationProvider>
			<P2PProvider>
				<Probe />
			</P2PProvider>
		</NotificationProvider>,
	);
	await waitFor(() => expect(listeners.has("p2p://message")).toBe(true));
});
afterEach(() => {
	cleanup();
	listeners.clear();
	vi.clearAllMocks();
});

describe("notifications from collaborators", () => {
	it("tells you when a guest joins, but not when you join a host", async () => {
		const peer = { id: "g1", name: "Raven", role: "Editor", status: "connected", isHost: false, connectionType: "direct" };
		await act(async () => listeners.get("p2p://peer-joined")?.({ payload: peer }));
		expect(notifications.items.map((n) => n.text)).toEqual(["Raven joined the workspace"]);
		await act(async () => listeners.get("p2p://peer-joined")?.({ payload: { ...peer, id: "h1", name: "Host", isHost: true } }));
		expect(notifications.items).toHaveLength(1);
	});

	it("tells you when a collaborator assigns a task to you", async () => {
		await change("me");
		expect(notifications.items.map((n) => n.text)).toEqual(['Ann assigned you "Ship it"']);
	});

	it("stays quiet for a task that was already yours, and for one assigned to someone else", async () => {
		storedTasks = [task("me")];
		await change("me");
		await change("someone-else");
		expect(notifications.items).toHaveLength(0);
	});
});
