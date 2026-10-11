// Building blocks shared by the app settings and the workspace settings, so both pages look and behave the same

import { useEffect, useState, type ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

// A titled card with an icon; `id` is what the section list on the left scrolls to
export function SectionCard({
	id,
	title,
	description,
	icon,
	children,
	className,
	titleClassName,
}: {
	id: string;
	title: string;
	description: string;
	icon: ReactNode;
	children: ReactNode;
	className?: string;
	titleClassName?: string;
}) {
	return (
		<Card id={id} className={cn("scroll-mt-8", className)}>
			<CardHeader>
				<CardTitle className={cn("flex items-center gap-2 text-base", titleClassName)}>
					{icon}
					{title}
				</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">{children}</CardContent>
		</Card>
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
				const first = sections.find((s) => seen.has(s.id));
				if (first) setActive(first.id);
			},
			{ rootMargin: "-10% 0px -65% 0px" },
		);
		for (const { id } of sections) {
			const el = document.getElementById(id);
			if (el) observer.observe(el);
		}
		return () => observer.disconnect();
	}, [sections]);

	return (
		<nav aria-label={label} className="sticky top-8 space-y-0.5">
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
