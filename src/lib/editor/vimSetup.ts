// What the Vim keys can ask the Editor page to do. The commands are the ones people reach for in Neovim with NvChad:
// :w and :q, buffers with Tab, and Space-prefixed finders.

export type VimCommand = "write" | "quit" | "writeQuit" | "files" | "commands" | "explorer" | "nextTab" | "prevTab" | "closeTab" | "split" | "panel" | "preview";

// Each editor has its own handler, found through the object the vim module gives for that editor
const handlers = new WeakMap<object, (command: VimCommand) => void>();
let defined = false;

type VimModule = typeof import("@replit/codemirror-vim");

export function vimCommands(mod: VimModule, cm: object, run: (command: VimCommand) => void) {
	handlers.set(cm, run);
	if (defined) return;
	defined = true;
	const { Vim } = mod;
	const ex = (name: string, prefix: string, command: VimCommand) => Vim.defineEx(name, prefix, (target: object) => handlers.get(target)?.(command));
	ex("write", "w", "write");
	ex("quit", "q", "quit");
	ex("wq", "wq", "writeQuit");
	ex("xit", "x", "writeQuit");
	ex("Files", "Fi", "files");
	ex("Commands", "Co", "commands");
	ex("Explorer", "Ex", "explorer");
	ex("bnext", "bn", "nextTab");
	ex("bprevious", "bp", "prevTab");
	ex("bdelete", "bd", "closeTab");
	ex("vsplit", "vs", "split");
	ex("Terminal", "Te", "panel");
	ex("Preview", "Pr", "preview");
	Vim.map("<Tab>", ":bnext<CR>", "normal");
	Vim.map("<S-Tab>", ":bprevious<CR>", "normal");
}

// Space-prefixed commands, as with NvChad's leader key. Vim's own Space motion would win over a mapped sequence, so the
// sequences are read here instead, only while the editor is in normal mode.
const LEADER: Record<string, VimCommand> = { ff: "files", fc: "commands", e: "explorer", x: "closeTab", v: "split", t: "panel", p: "preview" };

export function leaderKeys(isNormal: () => boolean, run: (command: VimCommand) => void) {
	let typed: string | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const reset = () => {
		typed = null;
		clearTimeout(timer);
	};
	return (e: KeyboardEvent): boolean => {
		if (e.ctrlKey || e.metaKey || e.altKey || !isNormal()) return false;
		if (typed === null) {
			if (e.key !== " ") return false;
			typed = "";
			timer = setTimeout(reset, 1500);
			return true;
		}
		if (e.key.length !== 1) return e.key === "Shift";
		typed += e.key;
		const hit = LEADER[typed];
		if (hit) {
			reset();
			run(hit);
		} else if (!Object.keys(LEADER).some((k) => k.startsWith(typed!))) reset();
		return true;
	};
}
