// Quick open, as in VS Code: type to find a file, start with > to run a command, start with : to jump to a line.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CornerDownLeft } from "@/components/animate-icons";

import FileKindIcon from "./FileKindIcon";
import FilePreview from "./FilePreview";
import Finder, { type FinderItem } from "@/components/elements/Finder";
import { baseName, folderOf } from "@/lib/editor/fileKinds";

export interface EditorCommand {
	id: string;
	label: string;
	hint?: string;
	group: string;
	icon?: ReactNode;
	run: () => void;
}

interface QuickOpenProps {
	open: boolean;
	// What the box starts with: nothing for files, ">" for commands, ":" for a line
	initialQuery: string;
	onClose: () => void;
	workspacePath: string;
	files: string[];
	recent: string[];
	commands: EditorCommand[];
	// `side` opens the file next to the current one
	onOpenFile: (path: string, side: boolean) => void;
	onGoToLine: (line: number) => void;
	hasFile: boolean;
}

export default function QuickOpen({ open, initialQuery, onClose, workspacePath, files, recent, commands, onOpenFile, onGoToLine, hasFile }: QuickOpenProps) {
	const [query, setQuery] = useState(initialQuery);
	useEffect(() => {
		if (open) setQuery(initialQuery);
	}, [open, initialQuery]);

	const mode = query.startsWith(">") ? "commands" : query.startsWith(":") ? "line" : "files";
	const line = Number.parseInt(query.slice(1), 10);

	const items = useMemo<FinderItem[]>(() => {
		if (mode === "commands") return commands.map((c) => ({ id: c.id, label: c.label, hint: c.hint, icon: c.icon, group: c.group }));
		if (mode === "line") return Number.isFinite(line) && line > 0 && hasFile ? [{ id: "line", label: `Go to line ${line}` }] : [];
		const recentSet = new Set(recent);
		const toItem = (path: string, group: string): FinderItem => ({ id: path, label: baseName(path), detail: folderOf(path), icon: <FileKindIcon name={baseName(path)} />, group });
		return [...recent.filter((p) => files.includes(p)).map((p) => toItem(p, "recent")), ...files.filter((p) => !recentSet.has(p)).map((p) => toItem(p, "files"))];
	}, [mode, commands, files, recent, line, hasFile]);

	const choose = (item: FinderItem, alt: boolean) => {
		onClose();
		if (mode === "commands") commands.find((c) => c.id === item.id)?.run();
		else if (mode === "line") onGoToLine(line);
		else onOpenFile(item.id, alt);
	};

	return (
		<Finder
			open={open}
			onClose={onClose}
			query={query}
			onQueryChange={setQuery}
			filterText={mode === "commands" ? query.slice(1) : mode === "line" ? "" : query}
			label={mode === "commands" ? "Command palette" : mode === "line" ? "Go to line" : "Quick open"}
			placeholder={mode === "commands" ? "Type a command…" : mode === "line" ? "Line number…" : "Find a file by name. > for commands, : for a line"}
			items={items}
			onChoose={choose}
			renderPreview={mode === "files" ? (item) => <FilePreview workspacePath={workspacePath} path={item.id} /> : undefined}
			empty={mode === "files" ? "No file matches." : mode === "commands" ? "No command matches." : hasFile ? "Type a line number." : "Open a file to jump to a line."}
			footer={
				<>
					<span className="flex items-center gap-1">
						<CornerDownLeft className="size-3" /> {mode === "files" ? "open" : "run"}
					</span>
					{mode === "files" && <span>Ctrl+Enter open to the side</span>}
					<span>↑↓ move</span>
					<span className="ml-auto">{mode === "files" ? "> commands  : line" : "Esc close"}</span>
				</>
			}
		/>
	);
}
