// A message to the person: an error or a success in a box, and the short red line under a field. One place decides the colours and the
// role, so a problem is announced to a screen reader the same way wherever it shows.

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const TONES = {
	error: "bg-destructive/10 text-destructive",
	success: "bg-success/10 text-success",
	info: "bg-info/10 text-info",
	warning: "bg-warning/10 text-warning",
} as const;

const FRAMES = { error: "border-destructive/40", success: "border-success/40", info: "border-info/40", warning: "border-warning/40" } as const;

export function Notice({ tone = "error", size = "md", framed, className, ...props }: { tone?: keyof typeof TONES; size?: "sm" | "md"; framed?: boolean } & ComponentProps<"p">) {
	return <p role={tone === "error" ? "alert" : "status"} className={cn("p-2", size === "sm" ? "text-xs" : "text-sm", TONES[tone], framed && cn("border", FRAMES[tone]), className)} {...props} />;
}

// The red line under a field that has a problem
export function FieldError({ className, ...props }: ComponentProps<"p">) {
	return <p role="alert" className={cn("text-xs text-destructive", className)} {...props} />;
}
