// The pieces every workspace page is built from, so they all read as one app: a toolbar along the top (see Toolbar), then
// a body that scrolls, made of titled panels or a full-width list, with one kind of empty state.

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// The page itself: fills the space under the header and never scrolls as a whole
export const Page = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>{children}</div>;

// The scrolling part under the toolbar. `padded` leaves the standard gutter around panels; lists run edge to edge without it.
export const PageBody = ({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) => (
	<div className={cn("min-h-0 flex-1 overflow-auto", padded && "p-4", className)}>{children}</div>
);

// A titled block: a title (with an icon if it has one) and a line of context, then its content. `flush` lets a list touch the edges.
export function Panel({ title, hint, children, className, right, flush, icon, id, titleClassName, index }: { index?: string; title: string; hint?: ReactNode; children: ReactNode; className?: string; right?: ReactNode; flush?: boolean; icon?: ReactNode; id?: string; titleClassName?: string }) {
	return (
		<section id={id} className={cn("frame flex min-w-0 flex-col bg-muted/40", className)}>
			<header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
				{index && <span className="shrink-0 font-mono text-[13px] text-primary" aria-hidden>{index}</span>}
				{icon && <span className={cn("flex size-5 shrink-0 items-center justify-center [&>svg]:size-5", titleClassName?.includes("destructive") ? "text-destructive" : "text-primary")}>{icon}</span>}
				<h2 className={cn("min-w-0 flex-1 truncate text-sm font-semibold text-foreground", titleClassName)}>{title}</h2>
				{hint && <p className="shrink-0 font-mono text-[13px] text-muted-foreground">{hint}</p>}
				{right}
			</header>
			<div className={cn("min-h-0 flex-1", !flush && "p-4")}>{children}</div>
		</section>
	);
}

// A numbered title for one part of a form or dialog: the number in the accent, then the title
export const SectionTitle = ({ n, title }: { n: string; title: string }) => (
	<h3 className="flex h-8 items-center gap-2 text-sm font-semibold">
		<span className="font-mono text-[13px] text-primary" aria-hidden>
			{n}
		</span>
		{title}
	</h3>
);

// What a page shows when there is nothing to list: an icon, a title, a sentence and maybe a button
export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
	return (
		<div className={cn("flex h-full min-h-48 flex-col items-center justify-center gap-2 p-8 text-center", className)}>
			{icon && <span className="text-muted-foreground [&>svg]:size-10">{icon}</span>}
			<h3 className="text-sm font-semibold">{title}</h3>
			{children && <p className="max-w-sm text-sm text-muted-foreground">{children}</p>}
			{action && <div className="mt-2">{action}</div>}
		</div>
	);
}
