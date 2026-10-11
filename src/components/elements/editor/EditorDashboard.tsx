// What the Editor shows when no file is open, in the spirit of NvChad's dashboard: a wordmark, the things to do next with
// their keys, and the files opened most recently.

import { Command, FilePlus, FileSearch, Keyboard, StickyNote, Terminal } from "@/components/animate-icons";

import FileKindIcon from "./FileKindIcon";
import { baseName, folderOf } from "@/lib/editor/fileKinds";

const WORDMARK = [
	"███╗   ██╗███████╗██╗  ██╗███████╗██╗   ██╗███╗   ██╗ ██████╗",
	"████╗  ██║██╔════╝╚██╗██╔╝██╔════╝╚██╗ ██╔╝████╗  ██║██╔════╝",
	"██╔██╗ ██║█████╗   ╚███╔╝ ███████╗ ╚████╔╝ ██╔██╗ ██║██║",
	"██║╚██╗██║██╔══╝   ██╔██╗ ╚════██║  ╚██╔╝  ██║╚██╗██║██║",
	"██║ ╚████║███████╗██╔╝ ██╗███████║   ██║   ██║ ╚████║╚██████╗",
	"╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝",
];

const TIPS = [
	"Type > in Quick open to run any command, and : followed by a number to jump to a line.",
	"Turn on Vim keys in Settings. Then Space f f finds files, Space e toggles the explorer and Tab cycles tabs.",
	"Ctrl+Enter in Quick open opens a file beside the one you are working on.",
	"Everyone in the workspace edits the same file live. Blame shows who wrote each line.",
	"Right-click a tab or a file for more: close the others, open to the side, copy the path.",
];

interface EditorDashboardProps {
	workspaceName: string;
	recent: string[];
	readOnly: boolean;
	onOpen: (path: string) => void;
	onQuickOpen: () => void;
	onCommands: () => void;
	onNewFile: () => void;
	onTogglePanel: () => void;
	onNotes: () => void;
}

export default function EditorDashboard({ workspaceName, recent, readOnly, onOpen, onQuickOpen, onCommands, onNewFile, onTogglePanel, onNotes }: EditorDashboardProps) {
	const actions = [
		{ label: "Find file", keys: "Ctrl P", icon: <FileSearch className="size-4" />, run: onQuickOpen },
		{ label: "Command palette", keys: "Ctrl Shift P", icon: <Command className="size-4" />, run: onCommands },
		...(readOnly ? [] : [{ label: "New file", keys: "Ctrl N", icon: <FilePlus className="size-4" />, run: onNewFile }]),
		{ label: "Toggle terminal", keys: "Ctrl J", icon: <Terminal className="size-4" />, run: onTogglePanel },
		{ label: "Open notes", keys: "", icon: <StickyNote className="size-4" />, run: onNotes },
	];
	const tip = TIPS[new Date().getDate() % TIPS.length];

	return (
		<div className="flex h-full overflow-y-auto p-8">
			<div className="m-auto flex flex-col items-center gap-8">
			<pre aria-label="Nexsync" className="font-mono text-[0.7rem] leading-[1.05] whitespace-pre text-primary select-none sm:text-sm">
				{WORDMARK.join("\n")}
			</pre>
			<p className="font-mono text-sm text-muted-foreground">{workspaceName}</p>

			<div className="grid w-full max-w-2xl gap-x-12 gap-y-8 md:grid-cols-2">
				<ul className="flex flex-col gap-1">
					{actions.map((a) => (
						<li key={a.label}>
							<button type="button" onClick={a.run} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted">
								<span className="text-primary">{a.icon}</span>
								<span className="flex-1">{a.label}</span>
								{a.keys && <kbd className="border bg-card px-1.5 py-0.5 font-mono text-xs text-muted-foreground shadow-[0_2px_0_var(--edge)]">{a.keys}</kbd>}
							</button>
						</li>
					))}
				</ul>

				<div className="flex flex-col gap-2">
					<h2 className="px-3 font-mono text-sm text-muted-foreground">recent files</h2>
					{recent.length === 0 ? (
						<p className="px-3 text-sm text-muted-foreground">Files you open are listed here.</p>
					) : (
						<ul className="flex flex-col gap-1">
							{recent.slice(0, 6).map((path) => (
								<li key={path}>
									<button type="button" onClick={() => onOpen(path)} className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted">
										<FileKindIcon name={baseName(path)} />
										<span className="truncate">{baseName(path)}</span>
										<span className="ml-auto truncate font-mono text-xs text-muted-foreground">{folderOf(path)}</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>

			<p className="flex max-w-2xl items-start gap-2 text-sm text-muted-foreground">
				<Keyboard className="mt-0.5 size-4 shrink-0 text-primary" />
				{tip}
			</p>
			</div>
		</div>
	);
}
