// The icon-only button every toolbar, bar and panel uses, so hover, selected and focus look the same everywhere: a name (the tooltip and the
// accessible name), an optional shortcut shown in the tooltip, `pressed` for a toggle that is on, and `badge` for a count on the corner.

import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The look of something chosen: the same tint on a toggle that is on, the page you are on and an open menu
export const chosenLook = "bg-primary/10 text-primary hover:bg-primary/20 focus-visible:bg-primary/20";
export const idleLook = "text-foreground";

// The count on the corner of an icon: the same size and place wherever it is used
export function Badge({ count, className }: { count: number; className?: string }) {
	if (count <= 0) return null;
	return <span className={cn("absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center bg-primary px-1 font-mono text-[11px] leading-4 font-bold text-primary-foreground", className)}>{count > 9 ? "9+" : count}</span>;
}

type ButtonProps = ComponentProps<typeof Button>;

export interface IconButtonProps extends Omit<ButtonProps, "aria-label" | "size" | "children"> {
	label: string;
	shortcut?: string;
	pressed?: boolean;
	badge?: number;
	// "xs" is for rows and panels, "sm" the usual one, "md" the window bar
	size?: "xs" | "sm" | "md";
	children: ReactNode;
}

export function IconButton({ label, shortcut, pressed, badge, size = "sm", variant = "ghost", className, children, ...props }: IconButtonProps) {
	return (
		<span title={shortcut ? `${label} (${shortcut})` : label} className="inline-flex">
			<Button
				variant={variant}
				size={size === "xs" ? "icon-xs" : "icon-sm"}
				aria-label={badge ? `${label}, ${badge} new` : label}
				aria-pressed={pressed}
				className={cn("relative", size === "md" && "size-9", variant === "ghost" && (pressed ? chosenLook : idleLook), className)}
				{...props}
			>
				{children}
				{badge !== undefined && <Badge count={badge} />}
			</Button>
		</span>
	);
}
