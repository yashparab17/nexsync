// Sets the app's version in the four places it lives, so that none is forgotten (the updater offers a build only when its version is higher than
// the installed one):
//   node scripts/bump-version.mjs 0.9.1            changes package.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock and src-tauri/tauri.conf.json
//   node scripts/bump-version.mjs 0.9.1 --release  (with --local: stops before pushing) also commits them as "Version 0.9.1", tags v0.9.1 and pushes the commit and the tag, which
//                                                  makes GitHub build, sign and draft the release (see .github/workflows/release.yml)
// The version is three numbers (0.9.1): Windows installers cannot carry words such as -beta in it. A tag with a dash (v0.9.1-1) is a pre-release.
// `--root <folder>` works on another folder, for the test.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const root = args.includes("--root") ? path.resolve(args[args.indexOf("--root") + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--root");

const FILES = ["package.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json"];

function fail(message) {
	console.error(message);
	process.exit(1);
}

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail("Give the new version as three numbers, for example: node scripts/bump-version.mjs 0.9.1");

// Each file's text with the version replaced, or an error that says which file did not have it where it should be
function bumped(file, text) {
	const replace = (re, to) => {
		if (!re.test(text)) fail(`${file}: the version was not where it is expected.`);
		return text.replace(re, to);
	};
	if (file === "package.json" || file.endsWith("tauri.conf.json")) return replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`);
	if (file.endsWith("Cargo.toml")) return replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`);
	return replace(/(\[\[package\]\]\r?\nname = "nexsync"\r?\nversion = ")[^"]+(")/, `$1${version}$2`);
}

const before = FILES.map((f) => readFileSync(path.join(root, f), "utf8"));
const current = /"version":\s*"([^"]+)"/.exec(before[0])?.[1];
const after = FILES.map((f, i) => bumped(f, before[i]));
FILES.forEach((f, i) => writeFileSync(path.join(root, f), after[i]));
console.log(`Version ${current} -> ${version} in ${FILES.join(", ")}`);

if (!flag("--release")) {
	console.log(`Next: commit, then  git tag v${version}  and  git push origin v${version}  (or run this again with --release).`);
	process.exit(0);
}

const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "inherit" });
// (not trimmed: the first character of a status line can be a space, which is part of the line)
const out = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
// Only the four files may have changed, or the release would carry half-finished work
const dirty = out("status", "--porcelain").split("\n").filter(Boolean).map((l) => l.slice(3).replace(/\\/g, "/"));
const other = dirty.filter((f) => !FILES.includes(f));
if (other.length) fail(`Not releasing: these files have changes that are not committed:\n  ${other.join("\n  ")}\nCommit or put them away first.`);
git("add", ...FILES);
git("commit", "-m", `Version ${version}`);
git("tag", `v${version}`);
if (flag("--local")) {
	console.log(`Committed and tagged v${version} here; nothing was pushed.`);
	process.exit(0);
}
git("push", "origin", "HEAD", `v${version}`);
console.log(`Pushed v${version}. GitHub is building it: https://github.com/yashparab17/nexsync/actions  When it is done, open the draft under Releases, edit its notes and publish it.`);
