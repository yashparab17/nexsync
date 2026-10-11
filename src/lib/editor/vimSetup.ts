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
	Vim.map("<Space>ff", ":Files<CR>", "normal");
	Vim.map("<Space>fc", ":Commands<CR>", "normal");
	Vim.map("<Space>e", ":Explorer<CR>", "normal");
	Vim.map("<Space>x", ":bdelete<CR>", "normal");
	Vim.map("<Space>v", ":vsplit<CR>", "normal");
	Vim.map("<Space>t", ":Terminal<CR>", "normal");
	Vim.map("<Space>p", ":Preview<CR>", "normal");
	Vim.map("<Tab>", ":bnext<CR>", "normal");
	Vim.map("<S-Tab>", ":bprevious<CR>", "normal");
}
