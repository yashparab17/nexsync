// The pieces every workspace page is built from, so they all read as one app: a toolbar along the top (see Toolbar), then
// a body that scrolls, made of titled panels or a full-width list, with one kind of empty state.

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// The page itself: fills the space under the header and never scrolls as a whole
export const Page = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>{children}</div>;

// The scrolling part under the toolbar. `padded` leaves the standard gutter around panels; lists run edge to edge without it.
export const PageBody = ({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) => (
	<div className={cn("min-h-0 flex-1 overflow-auto", padded && "p-3", className)}>{children}</div>
);

// A titled block: a title (with an icon if it has one) and a line of context, then its content. `flush` lets a list touch the edges.
export function Panel({ title, hint, children, className, right, flush, icon, id, titleClassName }: { title: string; hint?: ReactNode; children: ReactNode; className?: string; right?: ReactNode; flush?: boolean; icon?: ReactNode; id?: string; titleClassName?: string }) {
	return (
		<section id={id} className={cn("flex min-w-0 flex-col border bg-card/40", className)}>
			<header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
				{icon && <span className={cn("shrink-0 [&>svg]:size-5", titleClassName?.includes("destructive") ? "text-destructive" : "text-primary")}>{icon}</span>}
				<div className="min-w-0 flex-1">
					<h2 className={cn("text-sm font-semibold text-foreground", titleClassName)}>{title}</h2>
					{hint && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{hint}</p>}
				</div>
				{right}
			</header>
			<div className={cn("min-h-0 flex-1", !flush && "p-4")}>{children}</div>
		</section>
	);
}

// What a page shows when there is nothing to list: an icon, a title, a sentence and maybe a button
export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
	return (
		<div className={cn("flex h-full min-h-48 flex-col items-center justify-center gap-2 p-8 text-center", className)}>
			{icon && <span className="text-muted-foreground [&>svg]:size-10">{icon}</span>}
			<h3 className="text-base font-semibold">{title}</h3>
			{children && <p className="max-w-sm text-sm text-muted-foreground">{children}</p>}
			{action && <div className="mt-2">{action}</div>}
		</div>
	);
}
