// What the Editor shows when no file is open: the things to do next with their keys, and the files opened most recently.

import { Command, FilePlus, FileSearch, StickyNote, Terminal } from "@/components/animate-icons";

import Welcome from "@/components/elements/Welcome";
import FileKindIcon from "./FileKindIcon";
import { baseName, folderOf } from "@/lib/editor/fileKinds";

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
		{ label: "Open notes", icon: <StickyNote className="size-4" />, run: onNotes },
	];
	const tip = TIPS[new Date().getDate() % TIPS.length];

	return (
		<Welcome
			title={workspaceName ? `${workspaceName} editor` : "Editor"}
			intro="Open a file from the explorer, or pick one of these."
			actions={actions}
			recentTitle="Recent files"
			recent={recent.slice(0, 6).map((path) => ({ key: path, label: baseName(path), sub: folderOf(path), icon: <FileKindIcon name={baseName(path)} />, run: () => onOpen(path) }))}
			recentEmpty="Files you open are listed here."
			tip={tip}
		/>
	);
}
