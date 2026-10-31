// The small pieces of a side list (notes, files, documents...): its header, a row, and the line shown when it is empty.

import type { ComponentProps, ReactNode } from "react";

import Toolbar, { ToolbarSearch } from "@/components/layout/Toolbar";
import { cn } from "@/lib/utils";

// The header of a list pane: a search box that takes the room, then its buttons
export function PaneHeader({ children, className, ...search }: { children?: ReactNode; className?: string } & Pick<ComponentProps<typeof ToolbarSearch>, "label" | "value" | "onChange" | "placeholder">) {
	return (
		<Toolbar variant="header" className={className}>
			<ToolbarSearch {...search} className="min-w-0 flex-1" />
			{children}
		</Toolbar>
	);
}

// A row in a list pane; `chosen` marks the open one
export const listRow = (chosen?: boolean, className?: string) => cn("flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-[13px] outline-none hover:bg-muted focus-visible:bg-muted", chosen && "bg-muted", className);

// What a list says when it has nothing to show
export function EmptyNote({ children, className }: { children: ReactNode; className?: string }) {
	return <p className={cn("p-3 text-sm text-muted-foreground", className)}>{children}</p>;
}

// The small grey label over a group or beside a count
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
	return <span className={cn("font-mono text-[13px] text-muted-foreground", className)}>{children}</span>;
}

// A key on a shortcut hint
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
	return <kbd className={cn("border border-b-2 bg-card px-2 py-0.5 font-mono text-[13px] leading-5 text-muted-foreground", className)}>{children}</kbd>;
}
