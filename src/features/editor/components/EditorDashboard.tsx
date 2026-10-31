// What the Editor shows when no file is open: the wordmark, the things to do next with their keys, and the files opened most recently.

import { Command, FilePlus, FileSearch, StickyNote, Terminal } from "@/components/animate-icons";

import Welcome from "@/components/elements/Welcome";
import FileKindIcon from "@/features/editor/components/FileKindIcon";
import { baseName, folderOf } from "@/lib/editor/fileKinds";

const WORDMARK = [
	"███╗   ██╗███████╗██╗  ██╗███████╗██╗   ██╗███╗   ██╗ ██████╗",
	"████╗  ██║██╔════╝╚██╗██╔╝██╔════╝╚██╗ ██╔╝████╗  ██║██╔════╝",
	"██╔██╗ ██║█████╗   ╚███╔╝ ███████╗ ╚████╔╝ ██╔██╗ ██║██║     ",
	"██║╚██╗██║██╔══╝   ██╔██╗ ╚════██║  ╚██╔╝  ██║╚██╗██║██║     ",
	"██║ ╚████║███████╗██╔╝ ██╗███████║   ██║   ██║ ╚████║╚██████╗",
	"╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝",
].join("\n");

const TIPS = [
	"In Quick open, > runs a command and : jumps to a line.",
	"Vim keys are in Settings.",
	"Ctrl Enter in Quick open opens a file beside this one.",
	"Everyone edits the same file live. Blame shows who wrote a line.",
	"Right-click a tab or file for more.",
];

interface EditorDashboardProps {
	recent: string[];
	readOnly: boolean;
	onOpen: (path: string) => void;
	onQuickOpen: () => void;
	onCommands: () => void;
	onNewFile: () => void;
	onTogglePanel: () => void;
	onNotes: () => void;
}

export default function EditorDashboard({ recent, readOnly, onOpen, onQuickOpen, onCommands, onNewFile, onTogglePanel, onNotes }: EditorDashboardProps) {
	const actions = [
		{ label: "Find file", keys: "Ctrl P", icon: <FileSearch className="size-4" />, run: onQuickOpen },
		{ label: "Command palette", keys: "Ctrl Shift P", icon: <Command className="size-4" />, run: onCommands },
		...(readOnly ? [] : [{ label: "New file", keys: "Ctrl N", icon: <FilePlus className="size-4" />, run: onNewFile }]),
		{ label: "Toggle terminal", keys: "Ctrl J", icon: <Terminal className="size-4" />, run: onTogglePanel },
		{ label: "Open notes", icon: <StickyNote className="size-4" />, run: onNotes },
	];
	const tip = TIPS[new Date().getDate() % TIPS.length];

	return (
		<Welcome
			logo={WORDMARK}
			title="Editor"
			intro="Pick a file, or press Ctrl P."
			actions={actions}
			recentTitle="Recent Files"
			art="editor"
			recent={recent.slice(0, 6).map((path) => ({ key: path, label: baseName(path), sub: folderOf(path), icon: <FileKindIcon name={baseName(path)} />, run: () => onOpen(path) }))}
			recentEmpty="Recent files appear here."
			tip={tip}
		/>
	);
}
