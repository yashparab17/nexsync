import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const config = { display_name: "Sam", allowed_workspace_roots: ["C:\\Users\\Sam\\Documents"], proxy_url: "" };
const saveConfig = vi.fn(async (_config: unknown) => {});

vi.mock("@/lib/tauri", () => ({
	loadConfig: async () => ({ ...config, allowed_workspace_roots: [...config.allowed_workspace_roots] }),
	saveConfig: (c: unknown) => saveConfig(c),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));
const updater = { status: "idle", version: null, error: null, checkForUpdate: () => {}, installUpdate: () => {} };
vi.mock("@/hooks/useAppUpdater", () => ({ useAppUpdater: () => updater }));
// The real hook returns one stable function; a new one per render would reload the settings each time
const logError = () => {};
vi.mock("@/hooks/useErrorLog", () => ({ useErrorLog: () => logError }));
vi.mock("@/components/elements/ErrorLogCard", () => ({ default: () => <div>error log</div> }));

import { resetEditorPrefs } from "@/lib/editorPrefs";
import { APP_VERSION } from "@/lib/version";
import { ThemeProvider } from "@/store/ThemeContext";
import Settings from "./Settings";

const renderPage = () =>
	render(
		<MemoryRouter>
			<ThemeProvider>
				<Settings />
			</ThemeProvider>
		</MemoryRouter>,
	);

beforeEach(() => {
	saveConfig.mockClear();
	resetEditorPrefs();
	localStorage.clear();
});
afterEach(cleanup);

describe("Settings page", () => {
	it("offers to save once the name is edited, and saves it trimmed", async () => {
		renderPage();
		const input = await screen.findByLabelText("Display name");
		await waitFor(() => expect((input as HTMLInputElement).value).toBe("Sam"));
		expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();

		fireEvent.change(input, { target: { value: "  Alex  " } });
		fireEvent.click(await screen.findByRole("button", { name: /save changes/i }));

		await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1));
		expect(saveConfig).toHaveBeenCalledWith({ display_name: "Alex", allowed_workspace_roots: config.allowed_workspace_roots, proxy_url: "" });
		await screen.findByText("Settings saved.");
		expect(screen.queryByText(/restart nexsync/i)).toBeNull();
	});

	it("saves a proxy and says a restart is needed to use it", async () => {
		renderPage();
		const input = await screen.findByLabelText("Proxy address");
		fireEvent.change(input, { target: { value: " http://proxy.edu:8080 " } });
		fireEvent.click(await screen.findByRole("button", { name: /save changes/i }));
		await waitFor(() => expect(saveConfig).toHaveBeenCalledWith({ display_name: "Sam", allowed_workspace_roots: config.allowed_workspace_roots, proxy_url: "http://proxy.edu:8080" }));
		await screen.findByText(/restart nexsync to use the new proxy/i);
	});

	it("discards edits back to what was saved", async () => {
		renderPage();
		const input = (await screen.findByLabelText("Display name")) as HTMLInputElement;
		await waitFor(() => expect(input.value).toBe("Sam"));
		fireEvent.change(input, { target: { value: "Other" } });
		fireEvent.click(await screen.findByRole("button", { name: /discard/i }));
		expect(input.value).toBe("Sam");
		expect(saveConfig).not.toHaveBeenCalled();
	});

	it("adds a folder, refuses a duplicate, and will not save an empty list", async () => {
		renderPage();
		const path = await screen.findByLabelText("Folder path");
		await screen.findByText("C:\\Users\\Sam\\Documents");

		fireEvent.change(path, { target: { value: "c:/users/sam/documents/" } });
		fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
		expect(screen.getByText("That folder is already in the list.")).toBeTruthy();

		fireEvent.change(path, { target: { value: "D:\\Work\\" } });
		fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
		expect(screen.getByText("D:\\Work")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Remove C:\\Users\\Sam\\Documents" }));
		fireEvent.click(screen.getByRole("button", { name: "Remove D:\\Work" }));
		expect(screen.getByText(/add at least one folder/i)).toBeTruthy();
		expect((screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement).disabled).toBe(true);
	});

	it("shows why a save was refused", async () => {
		saveConfig.mockRejectedValueOnce(new Error("System directories cannot be added as allowed workspace roots."));
		renderPage();
		const input = await screen.findByLabelText("Display name");
		await waitFor(() => expect((input as HTMLInputElement).value).toBe("Sam"));
		fireEvent.change(input, { target: { value: "Alex" } });
		fireEvent.click(await screen.findByRole("button", { name: /save changes/i }));
		await screen.findByText(/System directories cannot be added/);
	});

	it("keeps the theme choice and the editor settings on this device", async () => {
		renderPage();
		fireEvent.click(await screen.findByRole("button", { name: "System" }));
		expect(localStorage.getItem("theme")).toBe("system");

		fireEvent.click(screen.getByRole("button", { name: "Larger text" }));
		fireEvent.click(screen.getByRole("button", { name: "8" }));
		const stored = JSON.parse(localStorage.getItem("nexsync.editorPrefs") ?? "{}");
		expect(stored).toMatchObject({ fontSize: 13, tabSize: 8 });
		expect(await screen.findByText(`v${APP_VERSION}`)).toBeTruthy();
	});
});
