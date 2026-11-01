import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LanguageServersCard from "@/components/elements/LanguageServersCard";
import type { LspServerInfo } from "@/features/projects/types";

const server = (over: Partial<LspServerInfo>): LspServerInfo => ({ id: "python", label: "Python", installed: false, install: "npm install -g pyright", recommended: true, path: null, installer: "npm", canInstall: true, extensions: ["py"], ...over });

const mocks = vi.hoisted(() => ({ lspServers: vi.fn(), lspInstall: vi.fn() }));
vi.mock("@/lib/tauri", () => mocks);

describe("language servers in Settings", () => {
	afterEach(cleanup);
	beforeEach(() => {
		mocks.lspServers.mockReset();
		mocks.lspInstall.mockReset();
	});

	it("shows what is installed and what is recommended, and hides the rest until asked", async () => {
		mocks.lspServers.mockResolvedValue([server({}), server({ id: "rust", label: "Rust", installed: true, path: "C:\\bin\\rust-analyzer.exe", extensions: ["rs"] }), server({ id: "lua", label: "Lua", recommended: false, installer: null, install: "https://luals.github.io/#install", extensions: ["lua"] })]);
		render(<LanguageServersCard />);
		expect(await screen.findByText("Python")).toBeTruthy();
		expect(screen.getByText("C:\\bin\\rust-analyzer.exe")).toBeTruthy();
		expect(screen.getByText("npm install -g pyright")).toBeTruthy();
		expect(screen.queryByText("Lua")).toBeNull();
		fireEvent.click(screen.getByText("Show All Languages"));
		expect(screen.getByText("Lua")).toBeTruthy();
		expect(screen.getByText("How to Install")).toBeTruthy();
	});

	it("installs a server with its button and looks again", async () => {
		mocks.lspServers.mockResolvedValueOnce([server({})]).mockResolvedValue([server({ installed: true, path: "C:\\npm\\pyright-langserver.cmd" })]);
		mocks.lspInstall.mockResolvedValue("added 1 package");
		render(<LanguageServersCard />);
		fireEvent.click(await screen.findByLabelText("Install Python language server"));
		await waitFor(() => expect(mocks.lspInstall).toHaveBeenCalledWith("python"));
		expect(await screen.findByText("C:\\npm\\pyright-langserver.cmd")).toBeTruthy();
		expect(screen.getByRole("status").textContent).toContain("Python is installed");
	});

	it("says why an install failed, and does not offer one when its tool is missing", async () => {
		mocks.lspServers.mockResolvedValue([server({}), server({ id: "go", label: "Go", installer: "go", canInstall: false, extensions: ["go"] })]);
		mocks.lspInstall.mockRejectedValue(new Error("Python could not be installed:\nEACCES"));
		render(<LanguageServersCard />);
		expect(await screen.findByText("Needs go")).toBeTruthy();
		fireEvent.click(screen.getByLabelText("Install Python language server"));
		expect(await screen.findByText(/EACCES/)).toBeTruthy();
	});
});
