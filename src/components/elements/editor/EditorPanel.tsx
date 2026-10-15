// The panel under the editor: command output, and the problems found in the open file.

import { forwardRef } from "react";
import { AlertTriangle, Play, Terminal, X } from "@/components/animate-icons";

import RunPanel from "./RunPanel";
import TerminalPanel, { type TerminalPanelHandle } from "./TerminalPanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PanelTab = "terminal" | "output" | "problems";

interface EditorPanelProps {
	// Whether the panel is on screen; terminals keep running when it is not
	open: boolean;
	tab: PanelTab;
	onTab: (tab: PanelTab) => void;
	onClose: () => void;
	workspacePath: string;
	activePath: string | null;
	problemLines: number[];
	onGoToLine: (line: number) => void;
}

export default forwardRef<TerminalPanelHandle, EditorPanelProps>(function EditorPanel({ open, tab, onTab, onClose, workspacePath, activePath, problemLines, onGoToLine }, terminalRef) {
	const tabs: { id: PanelTab; label: string; icon: React.ReactNode; count?: number }[] = [
		{ id: "terminal", label: "Terminal", icon: <Terminal className="size-4" /> },
		{ id: "output", label: "Output", icon: <Play className="size-4" /> },
		{ id: "problems", label: "Problems", icon: <AlertTriangle className="size-4" />, count: problemLines.length },
	];
	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			<div className="flex h-9 shrink-0 items-center border-b pr-1">
				<div role="tablist" aria-label="Panel" className="flex h-full">
					{tabs.map((t) => (
						<button
							key={t.id}
							type="button"
							role="tab"
							aria-selected={tab === t.id}
							onClick={() => onTab(t.id)}
							className={cn("flex h-full items-center gap-2 border-b-2 px-4 text-sm outline-none transition-colors focus-visible:bg-muted", tab === t.id ? "border-b-primary text-foreground" : "border-b-transparent text-muted-foreground hover:text-foreground")}
						>
							{t.icon}
							{t.label}
							{t.count ? <span className="bg-destructive/15 px-2 font-mono text-xs text-destructive">{t.count}</span> : null}
						</button>
					))}
				</div>
				<span className="flex-1" />
				<Button variant="ghost" size="icon-xs" aria-label="Close panel" onPress={onClose}>
					<X className="size-4" />
				</Button>
			</div>
			<div className="min-h-0 flex-1">
				{/* Terminals stay mounted, so their shells survive switching tabs and hiding the panel */}
				<div className={cn("h-full", tab !== "terminal" && "hidden")}>
					<TerminalPanel ref={terminalRef} workspacePath={workspacePath} dir="projects" visible={open && tab === "terminal"} />
				</div>
				{tab === "output" ? (
					<RunPanel workspacePath={workspacePath} activePath={activePath} />
				) : tab === "terminal" ? null : problemLines.length === 0 ? (
					<p className="p-4 text-sm text-muted-foreground">{activePath ? "No problems found in this file." : "Open a file to see its problems."}</p>
				) : (
					<ul className="h-full overflow-y-auto py-1">
						{problemLines.map((line) => (
							<li key={line}>
								<button type="button" onClick={() => onGoToLine(line)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-muted">
									<AlertTriangle className="size-4 shrink-0 text-destructive" />
									<span>Syntax error</span>
									<span className="font-mono text-xs text-muted-foreground">
										{activePath}:{line}
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
});
