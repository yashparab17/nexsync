// The strip above the editor: the path of the file as a breadcrumb on the left, and what can be done with it on the right.

import Toolbar from "@/components/layout/Toolbar";
import { ChevronRight, Columns3, Eye, FolderClose, GitBranch, History, MessageSquareDiff, Save, Search, Sparkles, Terminal, UsersRound, Check } from "@/components/animate-icons";

import type { CodeTabHandle, CodeTabStatus } from "@/features/editor/components/codeTabTypes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EditorToolbarProps {
	path: string | null;
	status?: CodeTabStatus;
	handle?: CodeTabHandle;
	explorerOpen: boolean;
	onToggleExplorer: () => void;
	showBlame: boolean;
	onToggleBlame: () => void;
	split: boolean;
	onToggleSplit: () => void;
	canPreview: boolean;
	preview: boolean;
	onTogglePreview: () => void;
	panelOpen: boolean;
	onTogglePanel: () => void;
}

function Tool({ label, shortcut, pressed, onPress, disabled, children }: { label: string; shortcut?: string; pressed?: boolean; onPress: () => void; disabled?: boolean; children: React.ReactNode }) {
	return (
		<Button variant={pressed ? "secondary" : "ghost"} size="icon-sm" aria-label={label} aria-pressed={pressed} isDisabled={disabled} onPress={onPress} className={cn(!pressed && "text-muted-foreground")}>
			<span title={shortcut ? `${label} (${shortcut})` : label} className="contents">
				{children}
			</span>
		</Button>
	);
}

export default function EditorToolbar({ path, status, handle, explorerOpen, onToggleExplorer, showBlame, onToggleBlame, split, onToggleSplit, canPreview, preview, onTogglePreview, panelOpen, onTogglePanel }: EditorToolbarProps) {
	const segments = path ? path.split("/") : [];
	return (
		<Toolbar variant="sub">
			<Tool label={explorerOpen ? "Hide explorer" : "Show explorer"} shortcut="Ctrl+B" pressed={explorerOpen} onPress={onToggleExplorer}>
				<FolderClose className="size-4" />
			</Tool>

			<nav aria-label="Path" className="flex min-w-0 flex-1 items-center gap-1 px-1 font-mono text-xs text-muted-foreground">
				{segments.map((segment, i) => (
					<span key={i} className="flex min-w-0 items-center gap-1">
						{i > 0 && <ChevronRight className="size-3 shrink-0 opacity-60" />}
						<span className={cn("truncate", i === segments.length - 1 && "font-semibold text-foreground")}>{segment}</span>
					</span>
				))}
			</nav>

			{path && handle && (
				<>
					<Tool label="Find in file" shortcut="Ctrl+F" onPress={() => handle.find()}>
						<Search className="size-4" />
					</Tool>
					<Tool label="File history" onPress={() => handle.history()}>
						<History className="size-4" />
					</Tool>
					{status?.hasBranches && (
						<Tool label="Branches" pressed={!!status.branch} onPress={() => handle.branches()}>
							<GitBranch className="size-4" />
						</Tool>
					)}
					{status?.canSuggest && (
						<Tool label="Suggest an edit" onPress={() => handle.suggest()}>
							<MessageSquareDiff className="size-4" />
						</Tool>
					)}
					{status?.canFormat && (
						<Tool label="Format file" shortcut="Shift+Alt+F" onPress={() => void handle.format()}>
							<Sparkles className="size-4" />
						</Tool>
					)}
					<span className="mx-1 h-5 w-px bg-border" aria-hidden />
				</>
			)}
			<Tool label={showBlame ? "Hide blame" : "Show blame"} pressed={showBlame} onPress={onToggleBlame}>
				<UsersRound className="size-4" />
			</Tool>
			{canPreview && (
				<Tool label={preview ? "Hide preview" : "Show preview"} shortcut="Ctrl+Shift+V" pressed={preview} onPress={onTogglePreview}>
					<Eye className="size-4" />
				</Tool>
			)}
			<Tool label={split ? "Close split" : "Open to the side"} shortcut="Ctrl+\" pressed={split} onPress={onToggleSplit} disabled={!path}>
				<Columns3 className="size-4" />
			</Tool>
			<Tool label={panelOpen ? "Hide panel" : "Show panel"} shortcut="Ctrl+J" pressed={panelOpen} onPress={onTogglePanel}>
				<Terminal className="size-4" />
			</Tool>

			{path && handle && status && !status.readOnly && !status.branch && (
				<Button size="sm" onPress={() => void handle.save()} isDisabled={status.saving || !status.dirty} className="ml-2">
					{status.dirty ? <Save className="size-4" /> : <Check className="size-4" />}
					{status.saving ? "Saving…" : status.dirty ? "Save" : "Saved"}
				</Button>
			)}
		</Toolbar>
	);
}
