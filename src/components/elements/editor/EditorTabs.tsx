// The row of open files, in the manner of VS Code and NvChad's bufferline: file icon, name, a dot when unsaved and a
// close button; middle-click closes, tabs can be dragged into a new order, and a right-click menu has the rest.

import { useRef, useState } from "react";
import { X } from "@/components/animate-icons";

import FileKindIcon from "./FileKindIcon";
import { baseName, folderOf } from "@/lib/editor/fileKinds";
import { cn } from "@/lib/utils";

interface EditorTabsProps {
	tabs: string[];
	active: string | null;
	// The file shown in the right-hand pane when the editor is split
	side: string | null;
	dirty: Set<string>;
	onSelect: (path: string) => void;
	onClose: (path: string) => void;
	onReorder: (from: number, to: number) => void;
	onContextMenu: (e: React.MouseEvent, path: string) => void;
}

export default function EditorTabs({ tabs, active, side, dirty, onSelect, onClose, onReorder, onContextMenu }: EditorTabsProps) {
	const [dragging, setDragging] = useState<number | null>(null);
	const [over, setOver] = useState<number | null>(null);
	const listRef = useRef<HTMLDivElement>(null);

	// Two open files with the same name show the folder they are in
	const duplicated = new Set(tabs.map(baseName).filter((name, i, all) => all.indexOf(name) !== i));

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
		const buttons = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[role=tab]") ?? []);
		const at = buttons.indexOf(document.activeElement as HTMLElement);
		const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : at + (e.key === "ArrowRight" ? 1 : -1);
		e.preventDefault();
		buttons[(next + buttons.length) % buttons.length]?.focus();
	};

	return (
		<div ref={listRef} role="tablist" aria-label="Open files" onKeyDown={onKeyDown} className="flex min-w-0 flex-1 overflow-x-auto">
			{tabs.map((path, i) => {
				const name = baseName(path);
				const isActive = active === path;
				return (
					<div
						key={path}
						role="presentation"
						draggable
						onDragStart={(e) => {
							setDragging(i);
							e.dataTransfer.effectAllowed = "move";
						}}
						onDragOver={(e) => {
							e.preventDefault();
							setOver(i);
						}}
						onDrop={() => {
							if (dragging !== null && dragging !== i) onReorder(dragging, i);
							setDragging(null);
							setOver(null);
						}}
						onDragEnd={() => {
							setDragging(null);
							setOver(null);
						}}
						onContextMenu={(e) => onContextMenu(e, path)}
						onAuxClick={(e) => {
							if (e.button === 1) {
								e.preventDefault();
								onClose(path);
							}
						}}
						className={cn(
							"group relative flex h-10 shrink-0 items-center border-r border-t-2 pr-1 text-sm transition-colors",
							isActive ? "border-t-primary bg-background text-foreground" : "border-t-transparent bg-card/60 text-muted-foreground hover:bg-card hover:text-foreground",
							over === i && dragging !== null && dragging !== i && "shadow-[inset_2px_0_0_var(--primary)]",
						)}
					>
						<button
							type="button"
							role="tab"
							aria-selected={isActive}
							tabIndex={isActive || (!active && i === 0) ? 0 : -1}
							onClick={() => onSelect(path)}
							title={path}
							className="flex h-full items-center gap-2 pr-1 pl-3 outline-none focus-visible:bg-muted"
						>
							<FileKindIcon name={name} />
							<span className={cn(isActive && "font-medium", side === path && "underline decoration-primary decoration-2 underline-offset-4")}>{name}</span>
							{duplicated.has(name) && <span className="font-mono text-xs text-muted-foreground">{folderOf(path).split("/").pop()}</span>}
						</button>
						<button
							type="button"
							aria-label={`Close ${path}`}
							onClick={() => onClose(path)}
							className="relative flex size-5 items-center justify-center text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted"
						>
							{dirty.has(path) && <span aria-label="Unsaved changes" className="absolute size-2 bg-warning group-hover:hidden" />}
							<X className={cn("size-3.5", dirty.has(path) ? "hidden group-hover:block" : isActive ? "" : "opacity-0 group-hover:opacity-100")} />
						</button>
					</div>
				);
			})}
		</div>
	);
}
