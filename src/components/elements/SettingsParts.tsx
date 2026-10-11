// Building blocks shared by the app settings and the workspace settings, so both pages look and behave the same

import { useEffect, useState, type ReactNode } from "react";

import { X } from "@/components/animate-icons";
import { Panel } from "@/components/layout/Page";
import Toolbar, { ToolbarTitle } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A row inside a card: what the setting is on the left, its control on the right
export function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<div className="min-w-0">
				<p className="text-sm font-semibold">{title}</p>
				{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
			</div>
			<div className="flex shrink-0 items-center gap-2">{children}</div>
		</div>
	);
}

// A few buttons of which exactly one is chosen
export function Segmented<T extends string | number>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: { value: T; label: string; icon?: ReactNode; count?: number }[];
	onChange: (value: T) => void;
}) {
	return (
		<div role="group" aria-label={label} className="inline-flex border">
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					aria-pressed={option.value === value}
					onClick={() => onChange(option.value)}
					className={cn(
						"flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors",
						option.value === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
					)}
				>
					{option.icon}
					{option.label}
					{option.count !== undefined && <span className="font-mono text-xs tabular-nums opacity-70">{option.count}</span>}
				</button>
			))}
		</div>
	);
}

// A titled panel with an icon; `id` is what the section list on the left scrolls to
export function SectionCard({ id, title, description, icon, children, className, titleClassName }: { id: string; title: string; description: ReactNode; icon: ReactNode; children: ReactNode; className?: string; titleClassName?: string }) {
	return (
		<Panel id={id} title={title} hint={description} icon={icon} titleClassName={titleClassName} className={cn("scroll-mt-3", className)}>
			<div className="space-y-4">{children}</div>
		</Panel>
	);
}

// The frame both Settings screens share, in the popup and as a page: a header that never scrolls away, with the title and
// a Close button, then the section list beside the sections, and a bar along the bottom while there is something to save
export function SettingsShell({ title, description, onClose, nav, navLabel, footer, className, children }: { title: string; description: ReactNode; onClose: () => void; nav: { id: string; label: string; icon: ReactNode }[]; navLabel: string; footer?: ReactNode; className?: string; children: ReactNode }) {
	return (
		<div className={cn("flex min-h-0 flex-col bg-background", className)}>
			<Toolbar>
				<ToolbarTitle name={title} />
				<span className="ml-1 hidden min-w-0 flex-1 truncate border-l pl-3 text-sm text-muted-foreground md:block">{description}</span>
				<span className="flex-1 md:hidden" />
				<Button variant="outline" size="sm" onPress={onClose} aria-label="Close settings">
					<X className="size-4" />
					Close
				</Button>
			</Toolbar>
			<div className="flex min-h-0 flex-1">
				<aside className="hidden w-52 shrink-0 overflow-y-auto border-r bg-sidebar p-2 md:block">
					<SectionNav label={navLabel} sections={nav} />
				</aside>
				<div data-settings-scroll className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-3">
					<div className="mx-auto max-w-3xl space-y-3">{children}</div>
				</div>
			</div>
			{footer && <div className="shrink-0 border-t bg-card/40">{footer}</div>}
		</div>
	);
}

// The list of sections down the left side; each button scrolls its card into view, and the one on screen is marked
export function SectionNav({ label, sections }: { label: string; sections: { id: string; label: string; icon: ReactNode }[] }) {
	const [active, setActive] = useState(sections[0]?.id);

	useEffect(() => {
		if (typeof IntersectionObserver === "undefined") return;
		const seen = new Set<string>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) (e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id));
				const current = sections.filter((s) => seen.has(s.id)).pop();
				if (current) setActive(current.id);
			},
			{ root: document.querySelector("[data-settings-scroll]"), rootMargin: "0px 0px -60% 0px" },
		);
		for (const { id } of sections) {
			const el = document.getElementById(id);
			if (el) observer.observe(el);
		}
		return () => observer.disconnect();
	}, [sections]);

	return (
		<nav aria-label={label} className="space-y-0.5">
			{sections.map(({ id, label: text, icon }) => (
				<button
					key={id}
					type="button"
					aria-current={active === id ? "true" : undefined}
					onClick={() => document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
					className={cn(
						"relative flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium transition-colors",
						active === id ? "bg-primary/10 text-primary before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:bg-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
					)}
				>
					{icon}
					{text}
				</button>
			))}
		</nav>
	);
}
