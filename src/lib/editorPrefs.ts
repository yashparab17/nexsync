import { useSyncExternalStore } from "react";

// How code and Markdown editors look on this device. Kept in localStorage, and shared live by every open editor.
export interface EditorPrefs {
	fontSize: number;
	tabSize: number;
	wrap: boolean;
}

export const DEFAULT_EDITOR_PREFS: EditorPrefs = { fontSize: 12, tabSize: 4, wrap: false };
export const FONT_SIZE_RANGE = { min: 10, max: 24 };
export const TAB_SIZES = [2, 4, 8];

const KEY = "nexsync.editorPrefs";
const listeners = new Set<() => void>();

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

// Anything unreadable or out of range falls back to the default, so a bad stored value never breaks the editor
function sanitize(raw: Partial<EditorPrefs>): EditorPrefs {
	const d = DEFAULT_EDITOR_PREFS;
	return {
		fontSize: Number.isFinite(raw.fontSize) ? clamp(raw.fontSize!, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max) : d.fontSize,
		tabSize: TAB_SIZES.includes(raw.tabSize as number) ? (raw.tabSize as number) : d.tabSize,
		wrap: typeof raw.wrap === "boolean" ? raw.wrap : d.wrap,
	};
}

function read(): EditorPrefs {
	try {
		return sanitize(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
	} catch {
		return DEFAULT_EDITOR_PREFS;
	}
}

// useSyncExternalStore needs the same object until something changes
let current = read();

export function setEditorPrefs(patch: Partial<EditorPrefs>) {
	current = sanitize({ ...current, ...patch });
	try {
		localStorage.setItem(KEY, JSON.stringify(current));
	} catch {
		// Private windows can refuse storage; the change still applies until the app closes
	}
	listeners.forEach((listener) => listener());
}

export function resetEditorPrefs() {
	setEditorPrefs(DEFAULT_EDITOR_PREFS);
}

export function useEditorPrefs(): EditorPrefs {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => current,
	);
}
