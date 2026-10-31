// A panel that opens under a button and closes on a click away or Escape. Put it inside the `relative` box that holds the button.

import { useEffect, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// The surface every floating panel shares
export const panelLook = "rounded-lg bg-popover ring-1 ring-foreground/10";

export function Popover({ open, onClose, label, align = "right", className, children }: { open: boolean; onClose: () => void; label: string; align?: "left" | "right"; className?: string; children: ReactNode }) {
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);
	if (!open) return null;
	return (
		<>
			<button type="button" aria-label={`Close ${label.toLowerCase()}`} className="fixed inset-0 z-[65] cursor-default" onClick={onClose} />
			<div role="region" aria-label={label} className={cn("absolute z-[66] mt-1 max-w-[90vw] overflow-hidden", panelLook, align === "right" ? "right-0" : "left-0", className)}>
				{children}
			</div>
		</>
	);
}
