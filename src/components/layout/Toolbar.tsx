// The strip along the top of a workspace page or panel. Every one shares its height, border, colour and side padding, so
// moving between Files, Assets, Notes and the Editor never makes the header jump.

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const VARIANTS = {
	// A page toolbar: wraps onto more rows when the window is narrow
	bar: "min-h-12 flex-wrap items-center gap-2 bg-card/40 px-3 py-1.5",
	// The title row of a side panel: a label, then icon buttons at the right
	header: "h-12 items-center gap-1 pr-2 pl-3",
	// A row of tabs that run the full height of the strip
	tabs: "h-12 items-stretch bg-card/40",
	// A second, slimmer row under a header: a filter box, editor actions
	sub: "h-10 items-center gap-1 px-3",
};

export default function Toolbar({ variant = "bar", className, ...props }: { variant?: keyof typeof VARIANTS } & ComponentProps<"div">) {
	return <div {...props} className={cn("flex shrink-0 border-b", VARIANTS[variant], className)} />;
}
