import type { ReactNode } from "react";

// The title block every workspace page opens with: a large title, one line of context, and the page's main actions on the right
export default function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
	return (
		<header className="mb-6 flex shrink-0 flex-wrap items-end justify-between gap-4">
			<div className="min-w-0">
				<h1 className="text-3xl font-bold tracking-tight">{title}</h1>
				{description && <p className="mt-1 max-w-prose text-muted-foreground">{description}</p>}
			</div>
			{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
		</header>
	);
}
