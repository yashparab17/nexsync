// The strip along the top of a workspace page or panel. Every one shares its height, border, colour and side padding, so
// moving between Files, Assets, Notes and the Editor never makes the header jump.

import type { ComponentProps, ReactNode } from "react";

import { Search, X } from "@/components/animate-icons";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const VARIANTS = {
	// A page toolbar: wraps onto more rows when the window is narrow
	bar: "min-h-12 flex-wrap items-center gap-2 bg-card/40 px-3 py-1",
	// The title row of a side panel: its name, then icon buttons at the right
	header: "h-12 items-center gap-1 bg-card/40 px-3",
	// A row of tabs that run the full height of the strip
	tabs: "h-12 items-stretch bg-card/40",
	// A second, slimmer row under a header: a filter box, editor actions
	sub: "h-10 items-center gap-1 px-3",
};

export default function Toolbar({ variant = "bar", className, ...props }: { variant?: keyof typeof VARIANTS } & ComponentProps<"div">) {
	return <div {...props} className={cn("flex shrink-0 border-b", VARIANTS[variant], className)} />;
}

// Filter tabs with a count each, like the kinds of asset: one is chosen, and the chosen one is filled
export function ToolbarTabs<T extends string>({ label, value, onChange, tabs }: { label: string; value: T; onChange: (value: T) => void; tabs: { key: T; label: string; count?: number }[] }) {
	return (
		<div role="tablist" aria-label={label} className="ml-1 flex items-center gap-1 overflow-x-auto border-l pl-3 first:ml-0 first:border-l-0 first:pl-0">
			{tabs.map((tab) => (
				<button
					key={tab.key}
					type="button"
					role="tab"
					aria-selected={value === tab.key}
					onClick={() => onChange(tab.key)}
					className={cn(
						"flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-sm whitespace-nowrap outline-none transition-colors focus-visible:bg-muted",
						value === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
					)}
				>
					{tab.label}
					{tab.count !== undefined && <span className="font-mono text-[13px] tabular-nums opacity-70">{tab.count}</span>}
				</button>
			))}
		</div>
	);
}

// The small search box at the right of a toolbar
export function ToolbarSearch({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
	return (
		<div className="relative w-44">
			<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
			<Input aria-label={label} placeholder={placeholder ?? label} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 border bg-background pr-7 pl-8 text-sm" />
			{value && (
				<button type="button" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange("")} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
					<X className="size-3.5" />
				</button>
			)}
		</div>
	);
}

// A few square buttons joined together, one pressed: tile size, list or calendar, and the like
export function ToolbarSwitch<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (value: T) => void; options: { value: T; label: ReactNode; title: string }[] }) {
	return (
		<div className="flex items-stretch border" role="group" aria-label={label}>
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					aria-pressed={value === o.value}
					aria-label={o.title}
					title={o.title}
					onClick={() => onChange(o.value)}
					className={cn("flex h-8 min-w-8 items-center justify-center px-1.5 font-mono text-[13px] outline-none focus-visible:bg-muted", value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

// The page name at the left of a toolbar, with what it holds after it in mono, as numbers are everywhere
export function ToolbarTitle({ name, meta, as: Heading = "h1" }: { name: string; meta?: ReactNode; as?: "h1" | "h2" }) {
	return (
		<Heading className="flex min-w-0 items-baseline gap-2 text-sm font-semibold">
			<span className="truncate">{name}</span>
			{meta !== undefined && meta !== "" && <span className="shrink-0 font-mono text-[13px] font-normal text-muted-foreground">{meta}</span>}
		</Heading>
	);
}
