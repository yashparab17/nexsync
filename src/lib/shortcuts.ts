// The workspace-wide keyboard shortcuts, in the VS Code style. The Editor and Notes keep their own (Ctrl+P, Ctrl+B, Ctrl+S…);
// these work on every page and never use a key they need.

export const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
export const MOD = IS_MAC ? "⌘" : "Ctrl";

// Alt+Shift+1…9 jump to a page; Alt+1…9 stay with the Editor's tabs
export const PAGE_KEYS = [
	["Dashboard", "/workspace/dashboard"],
	["Notes", "/workspace/notes"],
	["Editor", "/workspace/editor"],
	["Explorer", "/workspace/explorer"],
	["Files", "/workspace/files"],
	["Assets", "/workspace/assets"],
	["Tasks", "/workspace/tasks"],
	["Kanban board", "/workspace/kanban"],
	["Insights", "/workspace/insights"],
] as const;

export type Shortcut = { keys: string[]; label: string };
export const SHORTCUT_GROUPS: { title: string; items: Shortcut[] }[] = [
	{
		title: "Anywhere in the workspace",
		items: [
			{ keys: [MOD, "K"], label: "Search everything" },
			{ keys: [MOD, "Shift", "F"], label: "Search everything" },
			{ keys: [MOD, "Shift", "E"], label: "Open the Explorer" },
			{ keys: [MOD, ","], label: "Workspace settings" },
			{ keys: ["F1"], label: "Show these shortcuts" },
			{ keys: ["Esc"], label: "Close a popup or clear a search" },
		],
	},
	{ title: "Go to a page", items: PAGE_KEYS.map(([name], i) => ({ keys: ["Alt", "Shift", String(i + 1)], label: name })) },
	{
		title: "Editor",
		items: [
			{ keys: [MOD, "P"], label: "Go to file" },
			{ keys: [MOD, "Shift", "P"], label: "Command palette" },
			{ keys: [MOD, "S"], label: "Save" },
			{ keys: [MOD, "B"], label: "Toggle explorer" },
			{ keys: [MOD, "J"], label: "Toggle terminal" },
			{ keys: [MOD, "W"], label: "Close tab" },
			{ keys: ["Alt", "1–9"], label: "Switch to tab" },
		],
	},
];

// What a key press means to the workspace, or null when it is not one of ours
export type ShortcutAction = { type: "go"; to: string } | { type: "search" } | { type: "settings" } | { type: "help" };
export function shortcutFor(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): ShortcutAction | null {
	const mod = e.ctrlKey || e.metaKey;
	const key = e.key.toLowerCase();
	if (e.key === "F1" && !mod && !e.altKey) return { type: "help" };
	if (e.altKey && e.shiftKey && !mod) {
		const page = PAGE_KEYS[Number(/^Digit([1-9])$/.exec(e.code)?.[1]) - 1];
		return page ? { type: "go", to: page[1] } : null;
	}
	if (!mod || e.altKey) return null;
	if (e.shiftKey && key === "f") return { type: "search" };
	if (e.shiftKey && key === "e") return { type: "go", to: "/workspace/explorer" };
	if (!e.shiftKey && e.key === ",") return { type: "settings" };
	return null;
}
