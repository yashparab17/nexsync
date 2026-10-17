// Which Catppuccin icon a file or folder gets, by its name

import { EXTENSION_ICONS, FILE_NAME_ICONS, FILE_NAME_PATTERNS, FOLDER_ICONS, ICON_BODIES } from "@/lib/editor/fileIconData";

export function fileIconName(name: string): string {
	const lower = name.toLowerCase();
	const exact = FILE_NAME_ICONS[lower];
	if (exact) return exact;
	const pattern = FILE_NAME_PATTERNS.find(([re]) => re.test(lower));
	if (pattern) return pattern[1];
	const dot = lower.lastIndexOf(".");
	return (dot >= 0 && EXTENSION_ICONS[lower.slice(dot + 1)]) || "file";
}

export function folderIconName(name: string, open: boolean): string {
	const base = FOLDER_ICONS[name.toLowerCase()] ?? "folder";
	return ICON_BODIES[open ? `${base}-open` : base] ? (open ? `${base}-open` : base) : open ? "folder-open" : "folder";
}

export const iconBody = (icon: string): string => ICON_BODIES[icon] ?? ICON_BODIES.file ?? "";
