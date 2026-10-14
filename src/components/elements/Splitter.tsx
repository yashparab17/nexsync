// The draggable edge between two panels. Dragging, or the arrow keys when it has focus, report a new size.

import { useRef } from "react";

import { cn } from "@/lib/utils";

interface SplitterProps {
	// "vertical" is a line between side-by-side panels (it moves left and right)
	orientation: "vertical" | "horizontal";
	// Size of the panel being resized, and how to change it
	size: number;
	onResize: (size: number) => void;
	// Which edge of the panel the splitter is on: dragging towards the panel makes it smaller
	grows: "right" | "left" | "down" | "up";
	label: string;
	className?: string;
	// No highlight on hover or while dragging (the cursor still changes)
	quiet?: boolean;
}

export default function Splitter({ orientation, size, onResize, grows, label, className, quiet }: SplitterProps) {
	const drag = useRef<{ start: number; size: number } | null>(null);
	const vertical = orientation === "vertical";
	const sign = grows === "right" || grows === "down" ? 1 : -1;

	return (
		<div
			role="separator"
			aria-orientation={vertical ? "vertical" : "horizontal"}
			aria-label={label}
			aria-valuenow={size}
			tabIndex={0}
			onPointerDown={(e) => {
				e.currentTarget.setPointerCapture(e.pointerId);
				drag.current = { start: vertical ? e.clientX : e.clientY, size };
				document.body.style.userSelect = "none";
			}}
			onPointerMove={(e) => {
				if (!drag.current) return;
				const now = vertical ? e.clientX : e.clientY;
				onResize(drag.current.size + sign * (now - drag.current.start));
			}}
			onPointerUp={(e) => {
				drag.current = null;
				e.currentTarget.releasePointerCapture(e.pointerId);
				document.body.style.userSelect = "";
			}}
			onDoubleClick={() => onResize(0)}
			onKeyDown={(e) => {
				const step = e.shiftKey ? 48 : 16;
				const keys: Record<string, number> = vertical ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
				const dir = keys[e.key];
				if (!dir) return;
				e.preventDefault();
				onResize(size + sign * dir * step);
			}}
			className={cn(
				"group relative z-10 shrink-0 touch-none outline-none",
				vertical ? "w-px cursor-col-resize bg-border" : "h-px cursor-row-resize bg-border",
				className,
			)}
		>
			{/* A wider grab area than the one-pixel line */}
			<span className={cn("absolute transition-colors", !quiet && "group-hover:bg-primary/40 group-focus-visible:bg-primary/60 group-active:bg-primary/60", vertical ? "-inset-x-1 inset-y-0" : "inset-x-0 -inset-y-1")} />
		</div>
	);
}
