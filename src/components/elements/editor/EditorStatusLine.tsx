// The line along the bottom of the Editor, in the manner of NvChad's statusline: the Vim mode as a coloured block, the
// file, its branch and problems on the left; collaborators, language, indentation and the cursor position on the right.

import { AlertTriangle, GitBranch, UsersRound } from "@/components/animate-icons";

import type { CursorInfo } from "./CodeEditor";
import type { CodeTabStatus } from "./codeTabTypes";
import FileKindIcon from "./FileKindIcon";
import { baseName } from "@/lib/editor/fileKinds";
import { cn } from "@/lib/utils";

interface EditorStatusLineProps {
	// Vim mode such as "normal" or "visual:linewise"; empty when the Vim keys are off
	mode: string;
	path: string | null;
	status?: CodeTabStatus;
	cursor?: CursorInfo;
	viewers: string[];
	tabSize: number;
	onProblems: () => void;
}

const MODES: Record<string, { label: string; tone: string }> = {
	normal: { label: "NORMAL", tone: "bg-primary" },
	insert: { label: "INSERT", tone: "bg-success" },
	visual: { label: "VISUAL", tone: "bg-info" },
	replace: { label: "REPLACE", tone: "bg-destructive" },
};

export default function EditorStatusLine({ mode, path, status, cursor, viewers, tabSize, onProblems }: EditorStatusLineProps) {
	const [name, sub] = mode.split(":");
	const known = MODES[name];
	const progress = cursor ? (cursor.line === 1 ? "Top" : cursor.line >= cursor.lines ? "Bot" : `${Math.round((cursor.line / cursor.lines) * 100)}%`) : "";

	return (
		<div role="status" aria-label="Editor status" className="flex h-7 shrink-0 items-center border-t bg-card font-mono text-xs text-muted-foreground">
			{known && (
				<span className={cn("flex h-full items-center px-3 font-semibold text-background", known.tone)} style={{ clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 100%, 0 100%)", paddingRight: 16 }}>
					{known.label}
					{sub === "linewise" ? " LINE" : sub === "blockwise" ? " BLOCK" : ""}
				</span>
			)}
			{path && (
				<span className="flex min-w-0 items-center gap-2 px-3 text-foreground">
					<FileKindIcon name={baseName(path)} className="size-3.5" />
					<span className="truncate">{path}</span>
					{status?.dirty && <span aria-label="Unsaved changes" className="text-warning">[+]</span>}
					{status?.readOnly && <span className="border px-1 text-xs">RO</span>}
				</span>
			)}
			{status?.branch && (
				<span className="flex items-center gap-1 px-2 text-primary">
					<GitBranch className="size-3.5" />
					{status.branch}
				</span>
			)}
			{status && status.problemLines.length > 0 && (
				<button type="button" onClick={onProblems} className="flex items-center gap-1 px-2 text-destructive hover:bg-muted">
					<AlertTriangle className="size-3.5" />
					{status.problemLines.length}
				</button>
			)}

			<span className="flex-1" />

			{viewers.length > 0 && (
				<span className="flex items-center gap-1 px-2" title={viewers.join(", ")}>
					<UsersRound className="size-3.5 text-success" />
					{viewers.length}
				</span>
			)}
			{status && <span className="px-2">{status.language}</span>}
			{path && <span className="hidden px-2 sm:inline">UTF-8</span>}
			{path && <span className="hidden px-2 sm:inline">Spaces: {tabSize}</span>}
			{cursor && path && (
				<span className="px-2 tabular-nums">
					Ln {cursor.line}, Col {cursor.col}
					{cursor.selected > 0 && ` (${cursor.selected} selected)`}
				</span>
			)}
			{progress && <span className="w-12 px-2 text-right tabular-nums">{progress}</span>}
		</div>
	);
}
