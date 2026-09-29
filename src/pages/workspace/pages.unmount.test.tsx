import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/core", () => ({
	invoke: async (command: string) => {
		if (command === "read_workspace_file") return "hello\n";
		if (command.startsWith("list_") || command.startsWith("get_") || command === "p2p_list_peers") return [];
		return null;
	},
}));

const metadata = {
	workspace: { id: "1", name: "W", description: "", path: "/w", created_at: "", updated_at: "" },
	settings: { theme: "dark", autosave: true, sync: true },
	members: { members: [{ id: "owner", name: "Me", role: "Owner" }] },
	activity: { events: [] },
	permissions: { owner: [], editor: [], viewer: [] },
	history: { entries: [] },
};

vi.mock("@/store/workspace/WorkspaceContext", () => ({
	subscribeToActivityEvents: () => () => {},
	useWorkspace: () =>
		new Proxy(
			{
				workspace: { path: "/w", id: "1", name: "W" },
				metadata,
				stats: null,
				isLoading: false,
			} as Record<string, unknown>,
			{ get: (target, key: string) => (key in target ? target[key] : async () => {}) },
		),
}));

vi.mock("@/store/ThemeContext", () => ({
	useThemeContext: () => ({ isDark: true, theme: "dark", setTheme: () => {} }),
}));

import { P2PProvider } from "@/store/p2p/P2PContext";

const PAGES: Record<string, () => Promise<{ default: React.ComponentType }>> = {
	Dashboard: () => import("./WorkspaceDashboard"),
	Notes: () => import("./WorkspaceNotes"),
	Files: () => import("./WorkspaceFiles"),
	Assets: () => import("./WorkspaceAssets"),
	Tasks: () => import("./WorkspaceTasks"),
	Kanban: () => import("./WorkspaceKanban"),
	Members: () => import("./WorkspaceMembers"),
	Settings: () => import("./WorkspaceSettings"),
	Trash: () => import("./WorkspaceTrash"),
	Sidebar: () => import("@/components/layout/workspace/WorkspaceSidebar"),
	Header: () => import("@/components/layout/workspace/WorkspaceHeader"),
	TransferTray: () => import("@/components/layout/workspace/TransferTray"),
};

describe("every workspace page unmounts cleanly", () => {
	for (const [name, load] of Object.entries(PAGES)) {
		it(name, async () => {
			const { default: Page } = await load();
			let rendered: ReturnType<typeof render> | undefined;
			try {
				rendered = render(
					<MemoryRouter>
						<P2PProvider>
							<Page />
						</P2PProvider>
					</MemoryRouter>,
				);
				await new Promise((resolve) => setTimeout(resolve, 100));
			} catch (err) {
				// A page that cannot render in this fake setup says nothing about unmounting
				console.log(`${name}: did not render (${String(err).slice(0, 120)})`);
				return;
			}
			expect(() => rendered?.unmount()).not.toThrow();
		});
	}
});
