import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = path.resolve(__dirname, "../../scripts/bump-version.mjs");
const real = (f: string) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");
let dir = "";

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), "bump-"));
	mkdirSync(path.join(dir, "src-tauri"));
	// The real files, so that the script is tried on what it will really meet
	for (const f of ["package.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json"]) writeFileSync(path.join(dir, f), real(f));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (...a: string[]) => spawnSync("node", [script, ...a, "--root", dir], { encoding: "utf8" });
const read = (f: string) => readFileSync(path.join(dir, f), "utf8");

describe("the version bump", () => {
	it("sets the version in all four files and nothing else", () => {
		const r = run("9.8.7");
		expect(r.status, r.stderr).toBe(0);
		expect(JSON.parse(read("package.json")).version).toBe("9.8.7");
		expect(JSON.parse(read("src-tauri/tauri.conf.json")).version).toBe("9.8.7");
		expect(/^version = "9\.8\.7"$/m.test(read("src-tauri/Cargo.toml"))).toBe(true);
		expect(/name = "nexsync"\r?\nversion = "9\.8\.7"/.test(read("src-tauri/Cargo.lock"))).toBe(true);
		// Other packages' versions in the lock file are untouched
		expect(read("src-tauri/Cargo.lock").match(/^version = "9\.8\.7"$/gm)?.length).toBe(1);
		// Only the version lines differ
		for (const f of ["package.json", "src-tauri/Cargo.toml", "src-tauri/tauri.conf.json"]) {
			const was = real(f).split(/\r?\n/);
			const now = read(f).split(/\r?\n/);
			expect(now.length).toBe(was.length);
			expect(now.filter((l, i) => l !== was[i]).length).toBe(1);
		}
	});

	it("refuses a version that is not three numbers, and changes nothing", () => {
		for (const bad of ["0.9", "v0.9.1", "0.9.1-beta.1", "latest"]) {
			const r = run(bad);
			expect(r.status).toBe(1);
		}
		expect(run().status).toBe(1);
		expect(read("package.json")).toBe(real("package.json"));
	});
});
