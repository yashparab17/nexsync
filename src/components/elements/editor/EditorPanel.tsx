// The panel under the editor: command output, and the problems found in the open file.

import { forwardRef, useState, type RefObject } from "react";
import { AlertTriangle, ChevronDown, Play, Plus, Terminal, Trash2, X } from "@/components/animate-icons";

import RunPanel from "./RunPanel";
import TerminalPanel, { type TerminalPanelHandle, type TerminalSummary } from "./TerminalPanel";
import { useContextMenu } from "@/components/elements/ContextMenu";
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
	// Switching between the terminals that are open, from a menu in the header
	const [terminals, setTerminals] = useState<TerminalSummary>({ items: [], active: null });
	const menu = useContextMenu();
	const handle = terminalRef as RefObject<TerminalPanelHandle | null> | null;
	const current = terminals.items.find((t) => t.key === terminals.active);
	const openSwitcher = (e: React.MouseEvent<HTMLButtonElement>) => {
		const r = e.currentTarget.getBoundingClientRect();
		menu.open({ clientX: r.left, clientY: r.bottom + 2, preventDefault: () => {} }, [
			...terminals.items.map((t) => ({ label: t.title + (t.key === terminals.active ? "  ✓" : ""), icon: <Terminal className="size-4" />, onSelect: () => handle?.current?.select(t.key) })),
			"separator" as const,
			{ label: "New terminal", icon: <Plus className="size-4" />, shortcut: "Ctrl Shift `", onSelect: () => handle?.current?.newTerminal() },
			...(current ? [{ label: `Kill ${current.title}`, icon: <Trash2 className="size-4" />, danger: true, onSelect: () => handle?.current?.close(current.key) }] : []),
		]);
	};

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
							{t.count ? <span className="bg-destructive/15 px-1.5 font-mono text-xs text-destructive">{t.count}</span> : null}
						</button>
					))}
				</div>
				{tab === "terminal" && terminals.items.length > 0 && (
					<button
						type="button"
						aria-haspopup="menu"
						aria-label={`Switch terminal, now ${current?.title ?? "none"}`}
						onClick={openSwitcher}
						className="ml-2 flex h-7 items-center gap-1.5 border px-2 text-sm outline-none hover:bg-muted focus-visible:bg-muted"
					>
						<span className="max-w-40 truncate">{current?.title ?? "Terminal"}</span>
						<span className="font-mono text-xs text-muted-foreground">{terminals.items.length > 1 ? `${terminals.items.findIndex((t) => t.key === terminals.active) + 1}/${terminals.items.length}` : ""}</span>
						<ChevronDown className="size-3.5" />
					</button>
				)}
				<span className="flex-1" />
				<Button variant="ghost" size="icon-xs" aria-label="Close panel" onPress={onClose}>
					<X className="size-4" />
				</Button>
			</div>
			<div className="min-h-0 flex-1">
				{/* Terminals stay mounted, so their shells survive switching tabs and hiding the panel */}
				<div className={cn("h-full", tab !== "terminal" && "hidden")}>
					<TerminalPanel ref={terminalRef} workspacePath={workspacePath} dir="editor" visible={open && tab === "terminal"} onSummary={setTerminals} />
				</div>
				{tab === "output" ? (
					<RunPanel workspacePath={workspacePath} activePath={activePath} />
				) : tab === "terminal" ? null : problemLines.length === 0 ? (
					<p className="p-4 text-sm text-muted-foreground">{activePath ? "No problems found in this file." : "Open a file to see its problems."}</p>
				) : (
					<ul className="h-full overflow-y-auto py-1">
						{problemLines.map((line) => (
							<li key={line}>
								<button type="button" onClick={() => onGoToLine(line)} className="flex w-full items-center gap-3 px-4 py-1.5 text-left text-sm hover:bg-muted">
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
			{menu.menu}
		</div>
	);
});
