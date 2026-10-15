// What kind of file a name is, for the icon and colour it gets in tabs, the explorer and the finders

import { extensionOf } from "@/lib/editor/languages";

export type FileKind = "script" | "systems" | "web" | "data" | "markup" | "image" | "other";

const KINDS: Record<string, FileKind> = {
	js: "script", jsx: "script", ts: "script", tsx: "script", mjs: "script", cjs: "script", py: "script", rb: "script", php: "script", lua: "script", sh: "script", ps1: "script",
	rs: "systems", go: "systems", c: "systems", cpp: "systems", cc: "systems", h: "systems", hpp: "systems", java: "systems", kt: "systems", swift: "systems", cs: "systems",
	html: "web", css: "web", scss: "web", vue: "web", svelte: "web",
	json: "data", yaml: "data", yml: "data", toml: "data", xml: "data", sql: "data", csv: "data", lock: "data", env: "data",
	md: "markup", markdown: "markup", txt: "markup", log: "markup", rst: "markup",
	png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", ico: "image",
};

export const fileKind = (name: string): FileKind => KINDS[extensionOf(name)] ?? "other";

// Colour tokens, so the palette stays Catppuccin in both themes
export const KIND_TONE: Record<FileKind, string> = {
	script: "text-info",
	systems: "text-warning",
	web: "text-destructive",
	data: "text-primary",
	markup: "text-success",
	image: "text-primary",
	other: "text-muted-foreground",
};

export const baseName = (path: string) => path.split("/").pop() ?? path;
export const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");
