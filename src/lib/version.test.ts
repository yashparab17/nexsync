import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { APP_VERSION } from "./version";

// Tests run from the project folder
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("app version", () => {
	it("is the same in the frontend, the desktop shell and the Rust crate, so a release cannot ship with two numbers", () => {
		const frontend = (JSON.parse(read("package.json")) as { version: string }).version;
		const shell = (JSON.parse(read("src-tauri/tauri.conf.json")) as { version: string }).version;
		const crate = /^version\s*=\s*"([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1];
		expect(shell).toBe(frontend);
		expect(crate).toBe(frontend);
	});

	it("is what the build puts in the app, and is a plain version number", () => {
		const frontend = (JSON.parse(read("package.json")) as { version: string }).version;
		expect(APP_VERSION).toBe(frontend);
		expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	});
});
