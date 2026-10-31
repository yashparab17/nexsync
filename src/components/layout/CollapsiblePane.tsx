// A side panel with a draggable edge, like the main sidebar: drag it to change the width, drag it narrow enough and the panel folds
// away; double-click the edge for the usual width. Folded, it leaves a thin edge that opens it again, at the usual width, when dragged,
// and a small button.
// The width and the fold are kept per panel on this device. The panel's own width class is overridden by the width kept here.

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import Splitter from "@/components/elements/Splitter";
import { setCollapsed, useCollapsed } from "@/hooks/useCollapsed";
import { usePanelSize } from "@/hooks/usePanelSize";
import { cn } from "@/lib/utils";

// Every list at the left of a workspace page (notes, files, documents, channels, projects) opens at this width
export const LIST_WIDTH = 256;

const MIN_OPEN = 140;
const FOLD_BELOW = 110;
const MAX = 560;

export default function CollapsiblePane({ id, label, side = "left", defaultWidth = 240, className, children }: { id: string; label: string; side?: "left" | "right"; defaultWidth?: number; className?: string; children: ReactNode }) {
	const [collapsed] = useCollapsed(id);
	const [width, setWidth] = usePanelSize(`pane.${id}`, defaultWidth, MIN_OPEN, MAX);
	const grows = side === "left" ? "right" : "left";
	const Arrow = side === "left" ? ChevronRight : ChevronLeft;
	const open = () => {
		setWidth(defaultWidth);
		setCollapsed(id, false);
	};

	if (collapsed)
		return (
			<div data-pane={id} className={cn("relative flex min-h-0 shrink-0 flex-row", side === "right" && "flex-row-reverse", className)}>
				<Splitter orientation="vertical" grows={grows} size={0} onResize={(n) => n > 60 && open()} label={`Drag to show ${label}`} quiet />
				<button
					type="button"
					aria-label={`Show ${label}`}
					title={`Show ${label}`}
					onClick={open}
					className={cn("absolute top-1/2 z-20 flex h-10 w-4 -translate-y-1/2 items-center justify-center border bg-background text-muted-foreground opacity-60 shadow-sm outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring", side === "left" ? "left-0 rounded-r-sm border-l-0" : "right-0 rounded-l-sm border-r-0")}
				>
					<Arrow className="size-3" />
				</button>
			</div>
		);

	return (
		<div data-pane={id} className={cn("flex min-h-0 shrink-0", side === "right" && "flex-row-reverse", className)}>
			<div style={{ width }} className="flex min-h-0 min-w-0 shrink-0 [&>*]:w-full!">
				{children}
			</div>
			<Splitter
				orientation="vertical"
				grows={grows}
				size={width}
				onResize={(n) => {
					if (n === 0) setWidth(defaultWidth);
					else if (n < FOLD_BELOW) setCollapsed(id, true);
					else setWidth(n);
				}}
				label={`Resize ${label}`}
				quiet
			/>
		</div>
	);
}
